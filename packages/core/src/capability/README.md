# capability/ — the boundary a capability lives behind

Six files, six questions, one rule: a capability is ordinary code the platform must not trust.
Everything here exists to make that lack of trust structural rather than hopeful.

Read them in this order — it is also the import direction. `catalogue.ts` imports nothing from this
directory and everything else eventually reaches it, so a new import *into* the catalogue is the
signal that something has been put in the wrong file.

| File | The question it answers | The one thing to know |
|---|---|---|
| [`catalogue.ts`](catalogue.ts) | **What may be said.** The closed vocabularies — observations a capability can receive, resolvers it can ask, intents it can express — plus the facts the *platform* owns about each operation (idempotency, action-class floor, permission). | Closed on purpose (D61): a capability chooses from these and cannot extend them, which is where P3 isolation comes from — capabilities that share no vocabulary have nothing to call each other through. |
| [`declaration.ts`](declaration.ts) | **Who is speaking, and is the claim sound?** A capability's self-description — triggers, config keys, observations, resolvers, intents, permissions — with the two validators that judge it. | A declaration that lies about a platform-owned fact fails `checkAgainstCatalogue`. Write declarations through `declareCapability`, never by annotating `: TypedDeclaration`, or the literal tuples widen to `string[]` and every projection degrades to "any name". |
| [`registry.ts`](registry.ts) | **Which capabilities exist, and which may run?** The admitted set, the names `parseConfig` consumes, and the two lookups. | A retired name is tombstoned, never deleted, so old configs stay valid — and `get` is fail-closed on it while `describe` returns metadata that cannot be run (D58). |
| [`intent.ts`](intent.ts) | **What may be done.** The intent shape, the idempotency-key derivation, and `screenIntent` — the runtime checks every returned intent passes: attribution, declaration, class floors, warning symmetry, and the workflow map (D78, D90). | The screens repeat what the types already promise, deliberately: the far side may not have been compiled honestly. |
| [`factory.ts`](factory.ts) | **How is one built?** `intentFactoryFor` binds the occasion once, so an intent states only what it wants. | The ergonomics are also two contracts: an intent cannot omit its explanation, and an omitted `expected` claims nothing rather than claiming something wrong. |
| [`boundary.ts`](boundary.ts) | **How it plugs in.** The typed view a capability receives (its own settings only, meanings-not-labels) and the generic machinery deriving per-declaration types. | The projection is the enforcement of config isolation: a capability cannot read a neighbour's block because the view never contains it. |

The flow at runtime: an **observation** (from the catalogue) reaches a capability's `evaluate` through
its **view** (from boundary); it returns **intents** (built with factory), each of which passes the
**screens** (intent.ts) before the safety engine in `../safety/` ever sees it. Explanations ride along
and land in `../report/`.

What is deliberately *not* here: label strings (a capability speaks meanings; the adapter owns the
repository's words — `../config/`), the write rules (`../safety/`), and the transition tables the
screen consults (`../workflow/`). This directory defines the *shape* of a capability; it contains no
capability — those live outside core, and the disposable examples are in `probes/`.

## Your first capability — the whole idiom in ~30 lines

A capability is a declaration plus one pure async function. This one triages
unpositioned issues; it is real — the engine's own tests run its twin:

```ts
import {
    declareCapability,
    intentFactoryFor,
    type Capability,
} from "@hiero-hackers/automation-core";

export const triageDeclaration = declareCapability({
    name: "triage",
    triggers: [{ kind: "event", event: "issues" }],
    configKeys: [],
    observations: ["issueUpdated"],
    resolvers: [],
    intents: [
        {
            name: "applyMappedLabel",
            idempotencyClass: "idempotent",
            requiredPermissions: ["issues:write"],
        },
    ],
    permissions: { repository: ["issues:write"], organization: [] },
    operationalNeeds: {
        schedule: false,
        durableState: "none",
        crossItemCoordination: false,
        externalDelivery: false,
    },
});

export const triage: Capability<typeof triageDeclaration> = {
    declaration: triageDeclaration,
    async evaluate(observation) {
        if (observation.position.kind !== "position") return []; // conflicts are reported, never repaired
        if (observation.position.state.meaning !== null) return []; // already positioned
        const make = intentFactoryFor(triageDeclaration, {
            repository: observation.repository,
            item: observation.item,
            observedAt: observation.observedAt,
        });
        return [
            make({
                operation: "applyMappedLabel",
                actionClass: "reversibleStateChange",
                desired: { meaning: "awaitingTriage", cause: "intakeObserved" },
                cause: "issueWithoutPosition",
                expected: { meaningsAbsent: ["awaitingTriage"], closed: false },
                explain: { summary: "New issue placed in triage." },
            }),
        ];
    },
};
```

What the shape gives you without asking: an undeclared operation is a compile
error at the `make` call; the explanation is unskippable and becomes the
report's story; the `expected` claim is checked against the observation by the
engine (or at act time by the adapter); and everything you did NOT receive —
labels, Octokit, other capabilities, the mode — is the isolation guarantee.
Run it through `decide()` and you get a `Report` and, in `active` mode, one
approved intent. The probes in `packages/probes/src/` are three fuller worked examples.
