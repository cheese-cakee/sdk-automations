# engine/ — what the platform DOES with a delivery

Core's composition, and its only front door. A shell hands `decide()` a delivery, the parsed
configuration, the enabled capabilities, and the few facts core cannot know; it gets back a `Report`
and the intents that may act. Every other directory is something this one composes.

```mermaid
flowchart LR
    D["delivery<br/>(event + payload)"] --> N["events.ts<br/>normalize"]
    N --> P["projection<br/>(labels → position)"]
    P --> E["capability.evaluate<br/>via invoke.ts"]
    E --> S["screens<br/>capability/intent.ts"]
    S --> W["deriveWorld<br/>safety/world.ts"]
    W --> G["gates<br/>write / destructive"]
    G --> R["findings → Report"]
    G --> A["approved intents"]
```

| File | The question it answers |
|---|---|
| [`events.ts`](events.ts) | What does this raw webhook delivery MEAN, if anything? |
| [`invoke.ts`](invoke.ts) | How does the engine call a capability whose declaration type it cannot know? |
| [`decide.ts`](decide.ts) | What does the platform do with a delivery, start to finish? |
| [`index.ts`](index.ts) | The barrel. |

This directory owns the **wiring**, not the rules. The screens live in `capability/`, the gates in
`safety/`, the record in `report/`. If a decision is being made here that is not "which step runs
next", it is in the wrong place — that was the whole point of D92.

## Nothing throws

`decide()` is total, and the shape of that guarantee is worth stating once. An unreadable payload is
a `malformed` finding. A capability asking for a resolver it never declared is an
`undeclaredResolver` finding. A refused write is a verdict. A shell that cannot get a report back
has nothing to record, and an operator surface reading a crash learns nothing.

The corollary: an undeclared resolver is a **capability defect**, so it is a `problem`, not a
silently empty answer.

## The caller cannot lie about the world

The engine derives the safety context from the observation it was handed. It is not passed in.
`deriveWorld` produces a branded `DerivedWorld` whose constructor the barrel does not export, so a
shell asserting a precondition that contradicts its own delivery has **no type to assert it with**
(D77, D92 phase 4). This is the reason `DecideExternals` is as short as it is: everything on it is a
fact core genuinely cannot compute, and nothing on it is derivable.

## Three traps

**A sweep has no projection.** `staleItemsDue` carries no labels, so `projectionOf` returns `null`
and an intent's `expected` claim cannot be checked here. It is not waived — it rides along in the
adapter command and is rechecked against live GitHub at write time, the only place a sweep's
openness claim can honestly be checked.

**Destructive intents take the other door.** `destructiveOrWrite` routes them to
`evaluateDestructive` INSTEAD of `evaluateWrite`, not as well (D52), and the warning is rebuilt from
the STORED warned cause rather than the current request (D60, D72). Rebuilding from the current
request would let a drifted cause pass its own grace period.

**`toEngine` is a cast, and the argument for it lives in one place.** The engine holds a
heterogeneous list of capabilities and so has no single declaration type; `invoke.ts` carries the
soundness argument once, and the three `never`s in `decide()` are that erasure showing through.

## What keeps it honest

[`test/slice.test.ts`](../../test/slice.test.ts) is the parity specification: a real captured
delivery travels payload → report through the hand-wired pipeline, and `decide()` must reproduce it
finding-for-finding. Any divergence is a stop-work finding, not a test to update. The directory also
holds a ≥90% mutation threshold, which is what caught the destructive branch during D92 phase 3c.
