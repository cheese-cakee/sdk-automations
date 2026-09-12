# Write operations — three same-named files

> **The contract a write operation is built to (D133).** A write operation is one module per layer —
> core, shell, adapter — registered in a mapped-type registry per layer, so that forgetting a layer
> fails to compile in that layer. This page is the three module contracts, the absolute
> journal-row-compatibility rule, and the five write rules `decide()` cannot judge.

## 1. The recipe

Adding a write operation touches exactly this, and nothing else:

| Layer | Adds | The compiler catches |
|---|---|---|
| core | `capability/operations/<op>` — the platform's facts and the change wording — plus one key in `IntentCatalogue` | a key with no module, at the core registry |
| shell | `operations/<op>` — plan · serialize · parse · send · confirm — plus its call type in the `Call` union | a key with no handler, at the shell registry; a call the union does not hold, at `plan` |
| adapter | `operations/<op>` — endpoint shapes · verb builders — plus its endpoint names in the `WriteEndpoint` union | a key with no transport, at the adapter registry |

Each registry is typed `{ readonly [K in IntentOperation]: <Contract><K> }` and is the only place
the operations are listed. A module never imports its same-named sibling in another package; the
three same names are a convention for the file finder, not a dependency (the cruiser's layer rules
hold unchanged). Layer boundaries are untouched: core decides, the shell orchestrates, the adapter
talks to GitHub.

One obligation stands over the whole shape: the FX-gate protocol
(`packages/dev/lab/protocols/8.2-first-effects.md`) has not been re-run armed since the operations
moved into it, and no graced act ships against a repository until it has.

## 2. Core — `capability/operations/<op>`

**Location.** The plan named `engine/operations`; the modules live under `capability/` instead,
because the facts table is consumed BELOW the engine — `idempotencyOf` in `intent.ts` and the
declaration screen in `declaration.ts` both read it — and `engine/` imports `capability/`, never
the reverse. Putting the registry in the engine would mint the cycle the placement skill forbids.
The engine keeps the generic recipe (`change.ts`), which is what D128 asked of it.

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

**The registry** (`capability/operations/index`): `OPERATIONS`, typed by the mapped type above;
`INTENT_OPERATIONS` is DERIVED from it (`facts` per key) and keeps its name, its type and its place
in the public barrel — the slice test, the boundary test and the catalogue drift lock read it
unchanged. `IntentCatalogue` and `IntentOperation` stay in the catalogue file: the desired-outcome
shape is vocabulary a capability sees, and the key list is what the registry is checked against.

**The engine's generic recipe.** `describeChange(intent)` becomes one line over the registry;
`writeRequestFor` and `wouldApplyFinding` do not change. The one cast that correlates
`intent.operation` with its module is written once, in `change.ts`, with the argument beside it —
the pattern `invoke.ts` established for erased capability types.

## 3. Shell — `operations/<op>`

**The handler contract.** Keyed by operation, because the journal, the brakes and the report all
speak in operations; a handler owns every call verb its operation sends.

```ts
export interface OperationHandler<K extends IntentOperation> {
    /** The call verbs this operation's rows carry — `operationOf` is derived from these. */
    readonly verbs: readonly Call["verb"][];
    /** The calls one approved effect takes, in send order, or the reason it takes none. */
    plan(effect: Effect & { intent: Intent<K> }, config: RepositoryConfig): Plan;
    /** The row fields after the head — `verb` first, then the call's own fields, in row order. */
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
    /** Is a comment THIS effect's? Authorship and marker, both required (D125). */
    isMine(kind: ManagedCommentKind): (comment: CommentSeen) => boolean;
}
```

`CallOf<K>` is the member of `Call` a handler owns; each module exports its call type and the union
in the vocabulary file lists them, one line per operation. The vocabulary file keeps `Call`,
`JournaledCall`, `Plan`, `EffectOutcome` and the codes; its four exported functions —
`operationOf`, `serializeCall`, `parseJournaledCall`, `planFor` — become generic walks over the
registry. In the applier, `send` and `confirm` become one-line dispatches; the four-state
choreography around them (`journalAndSend`, `resolveOpen`, `runFrom`, `continueOpen`, the brakes,
the fresh gate) is untouched.

**Journal-row compatibility is absolute.** `serializeCall` writes `{capability, item}` then the
handler's fields, so insertion order — and therefore bytes — is what it was. Every row an armed
sandbox has already written parses: a handler may ADD a verb, and may never rename a verb, rename
or reorder a field, or change what `parse` refuses. The proof is a pinning test of the literal row
strings per verb, taken from the current implementation before the move and never edited after it.

## 4. Adapter — `operations/<op>`

**The transport contract.** Keyed by the same operation names, which the adapter already imports
from core.

```ts
/** The endpoint names the gate admits — the adapter's "one union member", kept below both readers. */
export type WriteEndpoint = "addLabel" | "removeLabel" | "createComment" | "updateComment";

export interface EndpointShape {
    readonly endpoint: WriteEndpoint;
    /** Structural match on method and the path's tail — never derived from the builder below. */
    matches(method: string, rest: readonly string[]): boolean;
    /** Cache keys a landed write makes untrustworthy. */
    invalidates(url: URL): readonly string[];
}

/** What a builder may use: the repository, and the one shared send-and-classify mechanism. */
export interface VerbContext {
    readonly repository: RepositoryRef;
    apply(request: GitHubWriteRequest, notFound: NotFoundMeaning): Promise<WriteResult>;
}

export interface OperationTransport {
    /** The endpoints this operation is allowed to reach — empty is a legal, refusing transport. */
    readonly endpoints: readonly EndpointShape[];
    /** The verbs this operation contributes to the write surface. */
    verbs(context: VerbContext): Partial<WriteVerbs>;
}
```

The admission gate keeps its origin pin, its GraphQL gate, its body rule and the grant precheck;
`writeEndpointOf` and `invalidatedBy` become one walk over the registry's shapes, which keeps the
preamble every shape shares — no query or fragment, `repos/{owner}/{repo}/issues`, encoded names —
in one place and hands each shape only its method and the path's tail. The send-and-classify
mechanism stays one function in the writes file and reaches the builders as `apply`. The vocabulary the
builders return in — `WriteResult`, `WriteVerbs`, `NotFoundMeaning` — sits in the transport file with
`WriteEndpoint`, below both readers, because the writes file imports the registry and a type that stayed
behind would close a cycle the cruiser refuses. `createWriteVerbs`
composes the verbs the transports contribute, and the `WriteVerbs` interface stays the closed
surface the shell sees. A transport holds both the matcher and the builder for its endpoints, and
they stay two spellings: the D129 rule that a gate must not trust the builder's string is kept, now
as a one-screen review rather than a two-file one. `unassign` is a transport with no endpoints and
no verbs today, which is exactly why the shell refuses it at send; the real unassign lands as an
endpoint in that module, not as a new file. `assign`, `lockIssue` and `unlockIssue` were added in
that shape and no other: each is three files per §1, its `send` refuses naming the endpoint the
matrix has no row for, and its `confirm` answers `"unknown"` because nothing reads an assignee list
or a lock state either.

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
- **Storing the operation in the journal row**: declined as before — the operation follows from the
  verb through the handler's `verbs`, and a fact derivable from the row is a fact that cannot
  disagree with it.

## 7. The five rules the engine cannot judge

`decide()` judges one request, so five write rules fall outside it — requirements on the executor
and the adapter rather than on a verdict. They were the ground-rules table of the retired
`effects.md`; each is now stated where it is enforced, and this table is the list so that none of
them goes missing between pages. `design/contracts/safety.md` §5 points here for them.

| Rule | Requirement | Stated in |
|---|---|---|
| Name the change | The exact item and value the write changes | §2 — `describeChange`, whose wording `design/contracts/safety.md` fixes and the slice parity test pins |
| Verify | Read the state back and confirm the postcondition | §3 — `confirm`; §4 — the read-back |
| Reconcile | Record an unclear outcome and never retry blind | the `unknown` outcome in `design/trace.md`; the two retry layers — the one in-client attempt in `packages/runtime/src/adapter/http.ts` and core's durable `retryAdvice` — which stop on a permanent failure |
| Tested reversal | Every operation has a tested disablement, repair and rollback path before it runs against a repository | the sandbox and pilot rings in `CONTRIBUTING.md` |
| Dry-run first | An operation appears in a new environment's dry-run before any active run performs it | the mode ladder in `design/contracts/config-schema.md`; step 9 of `design/trace.md` |

Two consequences worth stating once, because no single layer owns them: the adapter removes only the
values it manages and never every value under a prefix (`design/contracts/safety.md` §3), and a
destructive act reaches a repository only through the warning-and-grace path of
`design/guides/grace.md`.
