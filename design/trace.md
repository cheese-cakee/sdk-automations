# One label, start to finish

> The trace. A pull request is opened, `intake` wants the `awaitingTriage` label on it, and this
> page follows that one label from GitHub's POST to GitHub's API call, naming each hop, its file,
> and the one thing that hop protects. Read this before anything else in `design/`; the second
> half is the walkthrough for writing a capability.

## The route

| # | Hop | Where | What it protects |
|---|---|---|---|
| 1 | GitHub POSTs the webhook; the receiver checks the HMAC over the raw bytes and writes the delivery to the store before answering 202 | `packages/runtime/src/shell/receiver.ts` → `createReceiver`; `packages/core/src/github/signatures.ts` → `verifyBody`; `packages/runtime/src/store/store.ts` → `acceptDelivery` | a forged body never enters; an accepted delivery is never lost to a crash |
| 2 | The processor claims the delivery under a lease and loads the repository's `automations.yml` through the config source | `packages/runtime/src/shell/processor.ts` → `createProcessor`; `packages/core/src/config/parse.ts` | one worker at a time; a rejected config records why and acts on nothing |
| 3 | The delivery becomes facts: the normalizer reads the payload's labels and state, projects them through the repository's mappings into a `Projection`, and marks `unread` every fact group its row in `PRODUCERS` does not name | `packages/core/src/engine/normalize/pull-request.ts`; `packages/core/src/workflow/project.ts` → `projectPullRequest`; `packages/core/src/capability/producers.ts` → `PRODUCERS`; `design/contracts/facts.md` | a capability never sees a label string, and never sees a group nobody read |
| 4 | `decide()` finds the enabled capabilities whose declaration reads this fact kind and whose needed groups were read, projects each a view of its own settings and the mapped names, and calls `evaluate` | `packages/core/src/engine/decide.ts` → `decide`, `intentsFrom`; `packages/core/src/capability/boundary.ts` | isolation: a capability sees its block, the names of the mappings, and its declared resolvers — nothing else (P3, P4) |
| 5 | The capability returns intents: "set `awaitingTriage`, because `issueWithoutPosition`, claiming the item is open and the meaning absent" | `packages/capabilities/src/intake/capability.ts`; `packages/core/src/capability/factory.ts` → `intentFactoryFor` | an intent is a request, dated by its occasion, with a stable identity |
| 6 | The screen checks the intent names its own capability, a declared operation, its own item, and a legal transition on the workflow map | `packages/core/src/capability/intent.ts` → `screenIntent` | a capability cannot act as another, on another item, or off the map |
| 7 | The world is derived from the facts, not asserted: do the intent's claims hold against the projection the delivery carried? | `packages/core/src/safety/world.ts` → `deriveWorld` | a caller cannot assert a precondition its own delivery contradicts (D77) |
| 8 | The safety ladder judges the write request: kill switch, mode, capability enabled, grant present, item open and unpaused, precondition holding, no newer human change | `packages/core/src/safety/write.ts` → `evaluateWrite`; `packages/core/src/safety/rules.ts`; `packages/core/src/capability/operations/` for the operation's class and permission | every refusal is a code an operator reads; a destructive class is refused here and judged only at the grace door |
| 9 | The approval: the intent becomes an `Effect` with its managed-comment identity minted (for comments) and its `WriteRequest` snapshot; a record-only mode records `wouldApply` instead | `packages/core/src/engine/decide.ts` → `gateIntent`; `packages/core/src/capability/managed.ts` | dry-run says exactly what active would do; identity is platform-owned (D125) |
| 10 | The applier plans the effect as calls — for a label move, add the new label then remove the displaced one — journals each call as a row BEFORE sending, re-derives the world against a live read of the item, sends, and confirms the postcondition by read-back | `packages/runtime/src/shell/apply.ts` → `createApplier`; `packages/runtime/src/shell/operations/index.ts` → `planFor`, `serializeCall`; `packages/runtime/src/shell/operations/applyMappedLabel.ts` | a crash between journal and send is resent from the row; a human change between deciding and applying refuses the write; "applied" means observed, not assumed |
| 11 | The adapter admits the request by shape (the endpoint matrix as code), checks the grant, mints or reuses the installation token, sends, classifies the answer, and stales its cache | `packages/runtime/src/adapter/operations/applyMappedLabel.ts`; `packages/runtime/src/adapter/admission.ts` → `admit`; `packages/runtime/src/adapter/http.ts` → `createGitHubHttpClient`; `packages/runtime/src/adapter/readback.ts` → `createReadBack` | only the endpoints the matrix confirmed can be reached; no credential leaves this directory |
| 12 | The report — every finding and every effect's outcome — is persisted with the delivery, and the operator log names it | `packages/runtime/src/store/store.ts` → `completeDeliveryWithReport`; `packages/core/src/report/` | the record of what was decided and why outlives the process |

A sweep enters at hop 3 with a different producer: the driver decides which records exist — one per open item, with the groups its row in `PRODUCERS` promises — so the producer, not the capability, chooses which item a decision is about
(`packages/runtime/src/shell/sweep.ts`, `design/guides/sweep.md`) and hands `decide()` one record
per item. It is the other producer in `PRODUCERS`, and a producer decides which records exist —
hence which items a capability may write to at all, and how much of each one it may read. A destructive act takes hop 8 through the grace door instead (`design/guides/grace.md`):
the platform posts the warning, records it when it lands, and judges the act against the record.

## What each noun is, once

- **facts** — one item as the platform read it, with a `position` (the projection) and groups that
  are read or `unread`.
- **view** — the slice of the config a capability may see: its settings and the mapped names.
- **intent** — what a capability asks for: an operation, its desired value, its claims, its cause.
- **effect** — an approved intent on its way to GitHub, with identity. A managed comment's identity
  is per item and purpose; the effect id is per occasion.
- **call** — one GitHub step of an effect; its journal row is the call as bytes.
- **verdict / outcome** — what a door said (`apply`, `refuse` with a code, `recordOnly`), and what
  the applier made of an effect (`applied`, `already`, `refused`, `retryLater`, `unknown`).

## Writing a capability

If a capability needs more than this page says, the platform is missing something. Build the
smallest honest version, mark the rest not built with the reason, and write the finding in
`design/findings/` — never a workaround inside the capability. Every build so far has needed that
sentence at least once.

0. **Check the design against the platform before writing code.** Four lines, in the design page's
   Declaration table, each answered by a file:
   - facts and needs → the producers registry (`packages/core/src/capability/producers.ts`):
     every group you need must be read by a producer your trigger names, or boot refuses the
     declaration. A webhook reads the projection, `readiness`, `actor`, `author` and — on
     `issue_comment` — `command`; the sweep reads everything the endpoint matrix has confirmed.
   - resolvers → `RESOLVER_NAMES` in `packages/core/src/capability/catalogue.ts`, AND what feeds
     each one's input, AND which path answers it (a resolver needing a credential is `unavailable`
     on the credential-free path; the shell's stubbed externals list what they answer).
   - intents → `IntentCatalogue`'s desired payloads, in full: what you may say is exactly those
     fields. A label move's cause is chosen by the workflow map from the item's position
     (`moveTo`), not by you.
   - any "once" or "in place" promise → identity is per item and purpose (`kind` + `topic`);
     the effect id is per occasion. A comment with the same purpose on the same item is updated
     in place; two purposes need two topics.
   Designs written before the platform existed are often stale here. Correct the page first.
1. **Write the design page**, four sections: what it does, the config block, how it works (a
   flowchart of the guards in order), verified-by (the scenarios, which become the test titles).
   Read the exemplar nearest your shape: `prQuality` (webhook, resolvers, one comment), `intake`
   (webhook, labels, several stations), `inactivity` (schedule, clocks, destructive acts —
   nine files, one per concern, `declaration.ts` at the root).
2. **Baseline.** `pnpm -r test` and `pnpm -r test:coverage` before you touch anything, so a later
   red is yours.
3. **Make the folder** under `packages/capabilities/src/<name>/`: `capability.ts`, `settings.ts`
   (the spec, from `design/guides/capability-kits.md`), `capability.test.ts`, and the design page
   MOVED here as `design.md` (update the table in `design/guides/capabilities/README.md`). Four
   files is the minimum, not the shape: split by concern when a file answers two questions. Add
   one line to `packages/capabilities/src/index.ts`; the P3 matrix now covers you. If the folder
   already exists it is a seed — promote it in place.
4. **Declare** what you read in `catalogue.ts`'s words: fact kinds and groups, required mappings,
   resolvers, intents, and `evaluates` nothing else. A typo does not compile; a need no producer
   reads does not boot.
5. **Write `evaluate` in three captions**: read the settings (`readSettings`, `unusable`); the
   guards in the flowchart's order, each a visible `if` returning `[]` or `skipped(...)` — a design's
   "on event X" is a STATE here, never a trigger; then the act, intents through the factory. The
   judgements every capability makes live in `capability/facts.ts` (`isOpen`, `isPaused`,
   `isConflicted`, `people`, the clocks, `mentions`, `on`, `inert`, `moveTo`); import them, never a
   sibling.
6. **If you need a word the platform lacks**, this is what each costs and where it lives. A GitHub
   read or write the endpoint matrix (`design/findings/endpoint-permission-matrix.md`) has not
   confirmed is implemented and REFUSING until a sandbox protocol cites it — never called.

   | You need | Where it registers | What else it obliges |
   |---|---|---|
   | an operation | one module in each of `core/src/capability/operations/`, `runtime/src/shell/operations/`, `runtime/src/adapter/operations/` + a key in `IntentCatalogue` | a row pin in the shell's journal test; `pnpm contracts`; `design/guides/write-operations.md` |
   | a resolver | `RESOLVER_NAMES` + `ResolverCatalogue` in `catalogue.ts`; one arm in `runtime/src/adapter/resolvers.ts`, gated by `CONFIRMED_RESOLVER_READS` | a sentence in the generator's map; the credential-free path if it needs no credential |
   | a fact group | `FACT_GROUPS` + `GROUP_KEYS` in `catalogue.ts`; every producer's row in the registry; every producer | `facts.md` regenerates; fixtures |
   | a fact field (always read) | both fact interfaces; every producer; a `NORMALIZE_MALFORMED_CODES` entry if a payload may lack it | fixtures |
   | a producer (a new event) | one module in `core/src/engine/normalize/`, a union member and registry line in `engine/events.ts`, a row in the producers registry | a captured payload in the testkit, or a test that says there is none |
   | a mapping family | `config/schema.ts` (closed: a `MeaningFamily` spec; open-keyed: the open-family shape) + the toolkit reader | two error codes → `docs/configuration.md`, `config-schema.md` §6, and a reachable document per code |
   | a settings constructor | `capability/settings.ts`, with its rule stated | the kits guide's table |
   | a field on a desired payload | `IntentCatalogue` + the generator's `DESIRED_FIELDS` map | the shell handler that renders it |
   | a fact KIND, durable state, a cross-item read, a subject that is not an item | not coverable — the platform's unit of decision is one item | the smallest honest version, the rest marked not built, and a finding |

7. **Run the suite.** The checks read the working tree, so a new file is judged before it is
   committed. `pnpm contracts` regenerates the catalogue and producer tables. Keep working notes
   out of the tree (a study branch, or outside the repository) — every markdown file is checked as
   documentation.

The skills in `.claude/skills/` are the house style for what you write: `placement` (where a
file goes), `docstrings` (what a header says), `clarity` (how a body reads), `capability-design`
(the design page).
