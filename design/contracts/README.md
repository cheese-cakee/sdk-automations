# Contracts

What the code must keep satisfying. Every document here has a mechanically checked surface; the table
states that surface exactly. Prose outside it still requires review, so each contract also separates built
behavior from deferred work.

| Document | The check that reads it |
|---|---|
| [`taxonomy.md`](taxonomy.md) | `packages/dev/checks/test/doc-drift.test.ts` — every state-diagram edge equals a `PROFILE_EDGES` row |
| [`config-schema.md`](config-schema.md) | `packages/dev/checks/test/spec-drift.test.ts` — modes, accepted top-level keys, and every `ConfigErrorCode` |
| [`catalogue.md`](catalogue.md) | `packages/dev/checks/test/catalogue-drift.test.ts` — the four closed lists, and each intent's idempotency class, action class, and permission |
| [`contract.md`](contract.md) | `packages/dev/checks/test/contract-drift.test.ts` — §1's interfaces are the declaration's fields, exactly |
| [`safety.md`](safety.md) | `packages/dev/checks/test/safety-drift.test.ts` — refusal and record-only code tables, exactly |

**The entry rule: no implementation and no check, no entry.** A document arrives here only with code that
enforces its subject and a test that locks its closed vocabulary or shape. Future requirements belong in
[`../guides/`](../guides/) until that point. A check on one table does not turn unrelated future prose into
a built promise.

A guide is promoted here when its subject is built AND a check reads what remains. Built without a
check is not enough: `contract.md` sat in `guides/` for a month because its §1 sketch had drifted
from the type it described — a permissions block D62 deleted, and fields the code had renamed.

The system as it stands is drawn in [`../architecture.md`](../architecture.md).
