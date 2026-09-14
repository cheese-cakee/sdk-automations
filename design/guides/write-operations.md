# Write operations — three same-named files

> **The contract a write operation is built to (D133).** A write operation is one module per layer —
> core, shell, adapter — registered in a mapped-type registry per layer, so that forgetting a layer
> fails to compile in that layer. This page is the three module contracts, the absolute
> payload-compatibility rule, and the five write rules `decide()` cannot judge.

## 1. The recipe

Adding a write operation touches exactly this, and nothing else:

| Layer | Adds | The compiler catches |
|---|---|---|
| core | `core/src/intents/operations/<op>` — the platform's facts and the change wording — plus one key in `IntentCatalogue` | a key with no module, at the core registry |
| shell | `runtime/src/shell/apply/operations/<op>` — plan · serialize · parse · send · confirm — plus its call type in the `Call` union | a key with no handler, at the shell registry; a call the union does not hold, at `plan` |
| adapter | `runtime/src/adapter/writes/operations/<op>` — the verb builders — plus any endpoint it reaches in the client's confirmed table | a key with no transport, at the adapter registry |

Each registry is typed `{ readonly [K in IntentOperation]: <Contract><K> }` and is the only place
the operations are listed. A module never imports its same-named sibling in another package; the
three same names are a convention for the file finder, not a dependency (the cruiser's layer rules
hold unchanged). Layer boundaries are untouched: core decides, the shell orchestrates, the adapter
talks to GitHub.

One obligation stands over the whole shape: the FX-gate protocol
(`packages/dev/lab/protocols/8.2-first-effects.md`) has not been re-run armed since the operations
moved into it, and no graced act ships against a repository until it has.

## 2. Core — `intents/operations/<op>`

**Location.** The modules live beside the intent they describe, because the facts table is consumed
BELOW the engine — `idempotencyOf` in `intent.ts` and the declaration screen in `declaration.ts`
both read it — and `engine/` imports `intents/`, never the reverse. Putting the registry in the
engine would mint the cycle the placement skill forbids. The engine keeps the generic recipe
(`change.ts`), which is what D128 asked of it.

**The module contract.**

```ts
/** The change one intent of this operation makes — the fields describeChange may read. */
export interface ChangeSubject<K extends IntentOperation> {
    readonly capability: string;
    readonly desired: IntentCatalogue[K];
}

export interface OperationModule<K extends IntentOperation> {
    /** The platform's facts: idempotency class, action-class floor, permission (D62). */
    readonly facts: OperationFacts;
    /** contracts/safety.md's exact item-and-value wording; pinned by the slice parity test. */
    describeChange(subject: ChangeSubject<K>): string;
}
```

`describeChange` is a method, not a function-typed property, so a module for one `K` is assignable
where the registry's union is called — the same bivariance the engine already relies on. The module
imports types from the catalogue only; `intent.ts` and `declaration.ts` import the registry. That
is the import direction: catalogue → operations → intent/declaration → engine.

**The registry** (`intents/operations/index`): `OPERATIONS`, typed by the mapped type above;
`INTENT_OPERATIONS` is DERIVED from it (`facts` per key) and keeps its name, its type and its place
in the public barrel — the slice test, the boundary test and the catalogue drift lock read it
unchanged. `IntentCatalogue` and `IntentOperation` stay in the catalogue file: the desired-outcome
shape is vocabulary a capability sees, and the key list is what the registry is checked against.

**The engine's generic recipe.** `describeChange(intent)` becomes one line over the registry;
`writeRequestFor` and `wouldApplyFinding` do not change. The one cast that correlates
`intent.operation` with its module is written once, in `change.ts`, with the argument beside it —
the pattern `invoke.ts` established for erased capability types.

## 3. Shell — `apply/operations/<op>`

**The handler contract.** Keyed by operation, because the ledger, the gates and the report all
speak in operations; a handler owns every call verb its operation sends.

```ts
export interface OperationHandler<K extends IntentOperation> {
    /** The call verbs this operation's rows carry — `operationOf` is derived from these. */
    readonly verbs: readonly Call["verb"][];
    /** The calls one approved effect takes, in send order, or the reason it takes none. */
    plan(effect: Effect & { intent: Intent<K> }, config: RepositoryConfig): Plan;
    /** The row fields after the head — `verb` first, then the call's own, in row order. */
    serialize(call: CallOf<K>): Record<string, unknown>;
    /** The call a row's bytes hold, or `null`; total over `unknown`. */
    parse(row: unknown): CallOf<K> | null;
    /** One call, sent; the read-before-write for a comment lives here. */
    send(call: CallOf<K>, pass: SendContext): Promise<WriteResult>;
    /** Does GitHub say this call's postcondition holds? */
    confirm(call: CallOf<K>, pass: SendContext): Promise<Confirmation>;
}

/** What one send may know: the item, the two seams, and this effect's own identity. */
export interface SendContext {
    readonly item: ItemRef;
    readonly writer: EffectWriter;
    readonly reader: EffectReader;
    /** Is a comment the one THIS CALL would be? Authorship and marker, both required (D125). */
    isMine(body: string): (comment: CommentSeen) => boolean;
}
```

`CallOf<K>` is the member of `Call` a handler owns; each module exports its call type and the union
in the vocabulary file lists them, one line per operation. The vocabulary file (`effects.ts`) keeps
`Call`, `JournaledCall`, `Plan`, `EffectOutcome` and the codes; the four functions over them —
`operationOf`, `serializeCall`, `parseJournaledCall`, `planFor` — are generic walks over the
registry, in `apply/operations/index.ts`. In the applier, `send` and `confirm` are one-line
dispatches; the choreography around them — `sendCall`, `readBack`, the standing gate and the fresh
gate — answers the fold's five states, which `actionFor` reads as a table (D161, D172).

**Payload compatibility is absolute.** A `sent` fact's payload is the serialized call:
`serializeCall` writes `{capability, item}` then the handler's fields, so insertion order — and
therefore bytes — is what it was. Every payload an armed sandbox has already written parses: a
handler may ADD a verb, and may never rename a verb, rename or reorder a field, or change what
`parse` refuses. The proof is the per-verb pins of the literal payload strings in
`packages/runtime/test/shell/effects.test.ts`, which are unchanged.

## 4. Adapter — `writes/operations/<op>`

**The transport contract.** Keyed by the same operation names, which the adapter already imports
from core.

```ts
/** What a builder may use: the repository, and the one shared send-and-classify mechanism. */
export interface VerbContext {
    readonly repository: RepositoryRef;
    apply(request: GitHubWriteRequest, notFound: NotFoundMeaning): Promise<WriteResult>;
}

export interface OperationTransport {
    /** The verbs this operation contributes — none at all is a legal, refusing transport. */
    verbs(context: VerbContext): Partial<WriteVerbs>;
}
```

A transport declares verbs only; the endpoints they may reach are the client's table.
`WriteEndpoint`, `EndpointShape` and `writeEndpointOf` sit in
`packages/runtime/src/adapter/client/endpoints.ts`, one shape per confirmed endpoint with the grant
it needs and the keys its landing stales (D176). The admission gate keeps its origin pin, its
GraphQL gate, its body rule and the grant precheck, and matches a built URL against those shapes in
one walk, which keeps the preamble every shape shares — no query or fragment,
`repos/{owner}/{repo}/issues`, encoded names — in one place and hands each shape only its method and
the path's tail. The send-and-classify mechanism stays one function in the writes file and reaches
the builders as `apply`. The vocabulary the builders return in — `WriteResult`, `WriteVerbs`,
`NotFoundMeaning` — sits in the transport file below both readers, because the writes file imports
the registry and a type that stayed behind would close a cycle the cruiser refuses.
`createWriteVerbs` composes the verbs the transports contribute, and the `WriteVerbs` interface
stays the closed surface the shell sees. The matcher and the builder stay two spellings in two
files: the D129 rule that a gate must not trust the builder's string is kept. `unassign` is a
transport with no verbs today, which is exactly why the shell refuses it at send; the real unassign
lands as a verb in that module and a shape in the client's table, not as a new file. `assign`,
`lockIssue` and `unlockIssue` were added in that shape and no other: each is three files per §1, its
`send` refuses naming the endpoint the matrix has no row for, and its `confirm` answers `"unknown"`
because nothing reads an assignee list or a lock state either.

The read-back stays whole in R2: two resources do not earn a split (D89), and the third — an
assignee read — arrives with the real unassign and is the trigger to move each operation's reader
beside its transport.

## 5. What the compiler proves, per layer

The proof each layer's registry owes: add a scratch key to `IntentCatalogue` and confirm that the
core registry fails to compile; add a scratch shell handler without a registry line and confirm the
shell registry fails; add a scratch transport the same way for the adapter. Each error must land on
the registry object, not on a downstream use. Then delete the scratch.

## 6. Declined, with triggers

- **A shared cross-layer operation type** (one file describing all three layers): declined — it
  would be a module importing its same-named siblings across packages, which §1 forbids. Reopen never.
- **Deriving `Call` and `WriteEndpoint` from the registries** rather than writing the unions:
  declined — the union line is one edit per operation and reads as the closed vocabulary it is;
  derivation trades that for a type-level puzzle. Reopen if the unions pass a dozen members.
- **Splitting the read-back per operation**: deferred to the real unassign (§4).
- **Storing the operation in the `sent` fact**: declined — the operation follows from the fact's
  `verb` through the handler's `verbs`, and a stored copy could disagree with it.

## 7. The five rules the engine cannot judge

`decide()` judges one request, so five write rules fall outside it — requirements on the executor
and the adapter rather than on a verdict. They were the ground-rules table of the retired
`effects.md`; each is now stated where it is enforced, and this table is the list so that none of
them goes missing between pages. `design/contracts/safety.md` §5 points here for them.

| Rule | Requirement | Stated in |
|---|---|---|
| Name the change | The exact item and value the write changes | §2 — `describeChange`, whose wording `design/contracts/safety.md` fixes and the slice parity test pins |
| Verify | Read the state back and confirm the postcondition | §3 — `confirm`; §4 — the read-back |
| Reconcile | Record an unclear outcome and never retry blind | the `unknown` outcome in `design/trace.md`; the two retry layers — the one in-client attempt in `packages/runtime/src/adapter/client/http.ts` and core's durable `retryAdvice` — which stop on a permanent failure |
| Tested reversal | Every operation has a tested disablement, repair and rollback path before it runs against a repository | the sandbox and pilot rings in `CONTRIBUTING.md` |
| Dry-run first | An operation appears in a new environment's dry-run before any active run performs it | the mode ladder in `design/contracts/config-schema.md`; step 9 of `design/trace.md` |

Three consequences worth stating once, because no single layer owns them: the adapter removes only
the values it manages and never every value under a prefix (`design/contracts/safety.md` §3), a
destructive act reaches a repository only through the warning-and-grace path of
`design/guides/grace.md`, and the platform recognises its own assignment writes by its ledger
rather than by an event's actor, because GitHub attributes an `unassigned` event to the assignee
whoever made it (D159).
