# Pilot-ready v0

## Outcome

One installation observes a real repository with bounded GitHub use. An operator can explain its
decisions, restart it, and recover its store. Active writes require separate approval and proof.

[Milestone #2](https://github.com/hiero-hackers/sdk-automations/milestone/2) tracks the remaining
pilot work. The adapter, write path, PR dashboard, initial triage queue, and assignment's first
phase are built, and a version tag publishes the pilot image. A hosted pilot and complete triage
outcomes are not.

## Next gates

1. Close the disposable-repository triage rehearsal in
   [#189](https://github.com/hiero-hackers/sdk-automations/issues/189). Clean ready-label unlock,
   template-labelled entry, and a same-second release passed live
   ([protocol 8.6](../packages/dev/lab/protocols/8.6-triage-queue-live.md)). Keep
   `lockUntilTriaged` off by default until the scripted rehearsal passes in full on current main.
   Record the decisions and effects, not just the visible result.
2. Choose the temporary App owner, pilot host, and operator in
   [#191](https://github.com/hiero-hackers/sdk-automations/issues/191). Prove direct webhook
   delivery, health, restart, backup, restore, and rollback with a durable store
   ([protocol 8.7](../packages/dev/lab/protocols/8.7-backup-recovery.md) is the offline proof).
   Tag the version the pilot runs, so the operator can name it and roll back by tag.
3. Run [#190](https://github.com/hiero-hackers/sdk-automations/issues/190) in `observe` on one
   approved repository. Sophie conditionally approved Analytics after the prior tests pass and
   the App is installable. Its owner must install and configure it. Dry-run and active writes need
   their own approval and evidence.
4. Use pilot findings to finish triage outcomes. Assignment's first phase (claim and release) is
   built; its [protocol 8.2](../packages/dev/lab/protocols/8.2-first-effects.md) pass on the
   reviewed commit is owed before it ships, and a claim moving workflow state waits for the
   `ready` ownership rule (D220). Keep one owner for each automatic state transition. Do not add automatic triage or
   cross-capability state repair without a demonstrated need and a clear ownership rule.

## Independent work before wider rollout

[#192](https://github.com/hiero-hackers/sdk-automations/issues/192) measures per-capability costs
and onboarding bursts. This can proceed while the live pilot awaits credentials and hosting.
The credential-free [cost rehearsal](../packages/runtime/test/shell/compose/cost.test.ts) covers
inactivity first enabled on an existing repository and 100 repositories sharing the sweep's pool
across reset windows. It uses the composed client, fact reader, engine, and store. The
[sweep guide](guides/sweep.md#3-cost) records its scope and costs, including the three webhook
capabilities and two deliveries beside an exhausted sweep. Live write costs, large webhook bursts,
variable GraphQL costs, and secondary-limit behavior at fleet scale remain open.

[#194](https://github.com/hiero-hackers/sdk-automations/issues/194) tracks the Vitest 5 update.
Retry only after the upstream Stryker runner fix is released. Keep mutation thresholds unchanged.

## Working rule

Keep each change independently reviewable. Prefer one process, one durable store, and existing
capability seams until real use shows a missing abstraction. Unknown facts prevent unsafe writes;
retries must not duplicate effects; every effect must be explainable from the store.
