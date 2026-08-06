# capability/ — the boundary a capability lives behind

Four files, four concerns, one rule: a capability is ordinary code the platform must not trust.
Everything here exists to make that lack of trust structural rather than hopeful.

Read them in this order:

| File | Concern | The one thing to know |
|---|---|---|
| [`catalogue.ts`](catalogue.ts) | **What may be said.** The closed vocabularies — observations a capability can receive, resolvers it can ask, intents it can express — plus the facts the *platform* owns about each operation (idempotency, action-class floor, permission). | Closed on purpose (D61): a capability chooses from these and cannot extend them, which is where P3 isolation comes from — capabilities that share no vocabulary have nothing to call each other through. |
| [`declaration.ts`](declaration.ts) | **Who is speaking.** A capability's self-description — triggers, config keys, observations, resolvers, intents, permissions — with its validators and the registry that admits declarations. | A declaration that lies about a platform-owned fact fails `checkAgainstCatalogue`; a retired name is tombstoned, never deleted, so old configs stay valid. |
| [`intent.ts`](intent.ts) | **What may be done.** The intent shape, the idempotency-key derivation, and `screenIntent` — the runtime checks every returned intent passes: attribution, declaration, class floors, warning symmetry, and the workflow map (D78, D90). | The screens repeat what the types already promise, deliberately: the far side may not have been compiled honestly. |
| [`boundary.ts`](boundary.ts) | **How it plugs in.** The typed view a capability receives (its own settings only, meanings-not-labels) and the generic machinery deriving per-declaration types. | The projection is the enforcement of config isolation: a capability cannot read a neighbour's block because the view never contains it. |

The flow at runtime: an **observation** (from the catalogue) reaches a capability's `evaluate` through
its **view** (from boundary); it returns **intents** (from the catalogue), each of which passes the
**screens** (intent.ts) before the safety engine in `../safety/` ever sees it. Explanations ride along
and land in `../report/`.

What is deliberately *not* here: label strings (a capability speaks meanings; the adapter owns the
repository's words — `../config/`), the write rules (`../safety/`), and the transition tables the
screen consults (`../workflow/`). This directory defines the *shape* of a capability; it contains no
capability — those live outside core, and the disposable examples are in `probes/`.
