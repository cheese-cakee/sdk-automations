# Solution Architecture

This document proposes one architecture for the hosted Hiero maintainer-automation app. It combines the useful
parts of the solution drafts from PRs #15 and #16. The audits explain the problems; the taxonomy and config drafts
remain proposals until maintainers approve them.

## Decision status

| ID | Decision | Status |
|---|---|---|
| `D-001` | Hosted, config-driven GitHub App | Accepted |
| `D-002` | Strict TypeScript with runtime validation at external boundaries | Proposed |
| `D-003` | Observation to snapshot to intent to effect pipeline | Proposed |
| `D-004` | GitHub as the visible source of domain state | Proposed |
| `D-005` | Durable coordination for multi-worker reliability | Proposed |
| `D-006` | Separate issue and pull request state machines | Proposed |
| `D-007` | Exact MVP modules and behavior | Open |
| `D-008` | Final taxonomy and migration mappings | Open |
| `D-009` | Permission and webhook manifest | Open |
| `D-010` | Hosting, storage, secrets, retention, and operations | Open |
| `D-011` | Legacy structured-comment migration | Open |
| `D-012` | Pilot repository and rollback thresholds | Open |

Concrete examples below explain the proposal; they do not settle an open policy decision.

## What the audits taught us

C++ keeps labels and policy in one configuration, so it has little data drift. However, unrelated capabilities
share workflows, configuration, labels, and concurrency groups, which makes them difficult to adopt separately.

Python has many smaller workflows, but shared ideas are repeated as strings and labels in several places. That
makes individual files easy to remove while allowing policy and naming to drift. Recent Python lifecycle work
shows a better unit: one coherent domain responsibility with one source of truth, dry-run support, conservative
destructive behavior, isolated failures, and safe reopen handling.

The new app should preserve coherent shared rules without making modules depend on one another.

## The central rule

> A module evaluates an immutable snapshot and returns typed intents. It never calls GitHub, storage, or another
> module.

Every webhook and scheduled check follows the same path:

```text
GitHub event or reconciliation check
  -> authenticate and normalize the observation
  -> load and runtime-validate configuration
  -> build an immutable domain snapshot
  -> let enabled modules return typed intents
  -> refresh the decision under coordination
  -> authorize, arbitrate, validate transitions, and apply safety
  -> record one accepted effect plan
  -> perform narrow GitHub writes through one adapter
  -> record outcomes and optionally explain them to humans
  -> reconcile GitHub with the accepted plan
```

For example, an assignment module may request “assign this contributor to issue 42.” It cannot call an assignee
endpoint or replace labels. The core decides whether the request is authorized, legal, safe, and compatible with
other intents. The adapter performs only the accepted GitHub operations.

## System boundaries

### Intake and reconciliation

Webhook intake verifies the signature and installation, attaches a correlation ID, and converts the payload into
a domain observation. It does not make lifecycle decisions.

Reconciliation uses the same decision pipeline to detect missed webhooks, direct maintainer changes, delayed work,
and partially applied plans. Slow sweeps and safety timers run as bounded scheduled work, not inside a webhook
response.

### Configuration and registry

The app reads strict JSON from the default branch and may resolve an explicit `_extends` source. It validates every
raw source and the final resolved value at runtime. TypeScript types alone are insufficient because repository
configuration is external data. Missing, invalid, or inaccessible configuration enables no destructive behavior
and produces an actionable diagnostic.

Each module declares its observations, config schema, domain reads, intents, transitions, permissions, scheduled
work, projection keys, and conflict classes. The registry supplies only that module's validated config slice and
checks that the installation has the declared capabilities.

### Snapshots and modules

A snapshot contains normalized issues, pull requests, links, assignees, reviews, managed labels, actor capability,
and relevant timestamps. Raw Octokit objects stop at the adapter boundary. Snapshots are immutable during an
evaluation pass.

A module is deterministic:

```text
(observation, snapshot, validated module config) -> intents and diagnostics
```

It receives no Octokit client, database handle, clock, environment access, generic service locator, or neighboring
module. Its result is data, not callbacks or GitHub operations. A follow-up module contract can make the exact
declarations and common tests normative after this architecture is approved.

### Core

The core speaks domain vocabulary such as actors, linked work, eligibility, transitions, conflicts, and safety. It
must not grow service-shaped operations such as `markReadyForAssignment` or `resetAfterReap`.

The core owns:

- actor and intent authorization;
- canonical resolution of links, eligibility, fields, and bot identity;
- legal issue and pull request transitions;
- deterministic arbitration between conflicting intents;
- invariants that span assignment and lifecycle state;
- warning, cancellation, grace period, and recovery rules for destructive actions;
- explicit effect plans and structured decision outcomes.

The core does not render prose, call GitHub, or implement module-specific policy.

### Coordination

GitHub remains the visible source of issue, pull request, assignment, review, and label state. Operational storage
contains only what is needed to coordinate work: delivery and command identities, accepted-plan claims, leases,
effect attempts, scheduled actions, retries, projection keys, and reconciliation cursors.

Preliminary evaluation may only discover a conservative set of affected issue or pull request keys. After those
keys are acquired in canonical order, the app reloads config revisions, actor capability, links, and GitHub state,
then reruns evaluation and safety. If the affected set expands, it releases coordination and restarts before any
write. Only this refreshed decision may become an accepted plan.

The coordinator atomically records one accepted plan before external writes begin. A renewable lease grants one
worker execution authority, but it does not make GitHub calls exactly once. If a result becomes unknown after a
timeout or lost lease, a recovery worker adopts the same plan, probes GitHub, and reconciles or retries it before a
conflicting plan can proceed. No database transaction remains open across a GitHub API call.

A deliberately single-replica first deployment is possible only if that limitation is explicit and tested. High
availability requires durable coordination; an in-process queue alone is not the correctness boundary.

### Effects, outcomes, and human explanations

The effect planner turns an accepted intent into ordered, narrow, idempotent operations. Each effect has a stable
identity, preconditions, an expected result, and a retry, compensation, or reconciliation path.

Only the GitHub adapter calls GitHub. It owns pagination, API versions, rate limits, and error classification. It
adds or removes only managed values and never replaces all labels from a stale snapshot.

The executor records what the core decided and what GitHub returned. Examples include `applied`,
`already_satisfied`, `rejected_unauthorized`, `rejected_illegal_transition`, `blocked_by_human`,
`delayed_for_safety`, `unknown_external_result`, and `retryable_failure`. A partial plan remains recorded and is
reconciled; several GitHub calls are never treated as one transaction.

When a maintainer needs an explanation, a projection writer turns the structured outcome into a comment or check.
It owns stable keys, rendering, update behavior, and noise policy. Modules never parse rendered prose. Publishing
that explanation is a separate GitHub write through the same adapter, not a repeat of the domain effect.

## State ownership and module independence

Issues and pull requests are separate entities with separate proposed state machines. A linked contribution
aggregate coordinates operations that must keep them consistent. Exact states, transitions, blocking behavior,
and migration mappings remain in [`taxonomy-draft.md`](taxonomy-draft.md) until ratified.

The core is the only automated writer of managed lifecycle labels. A direct maintainer change is an external
transition request. Reconciliation follows an approved policy: accept a legal transition, repair a deterministic
inconsistency, or quarantine an ambiguous state and explain the required choice.

Every state consumed by a module must also have a manual or native entry path. An upstream module may automate an
input, but it cannot be the only way a downstream module works. Disabling a module must retire its scheduled work
without corrupting shared state or disabling another module.

## Reliability rules

- A GitHub delivery ID deduplicates one delivery.
- A slash command is identified by repository, subject, created-comment ID, command position, and normalized text.
  Editing an old comment never executes a new command.
- An intent identity prevents the same semantic request from being reapplied after a retry.
- Arbitration resolves incompatible intents without depending on module registration order.
- An atomic plan claim gives one winner when concurrent requests compete for the same capacity.
- Idempotent writes, result probes, and reconciliation converge GitHub state without claiming exactly-once calls.
- Refreshed state, not webhook arrival order or timestamps, determines whether a transition is still legal.
- Records have explicit retention, and logs exclude secrets and unnecessary contributor content.

## Permissions, testing, and rollout

The GitHub App requests the verified union of permissions and events required by the supported modules. Repository
toggles do not dynamically change the installation manifest. A module stays inactive when an older installation
lacks a required capability. `contents:write` is forbidden, and optional fields, checks, team membership, or
organization projects require explicit permission and portability review.

Pure domain tests, shared module-contract tests, adapter fixtures, webhook tests, property tests, concurrency and
crash tests, reconciliation tests, permission and security checks, and sandbox exercises cover different failure
boundaries. The existing [`test-architecture.md`](test-architecture.md) is the starting verification model.

Rollout moves through observation with no writes, reversible sandbox writes, a non-destructive pilot, and only then
destructive behavior after warning, cancellation, recovery, and rollback are demonstrated. During migration, the
old and new systems never write the same lifecycle state concurrently.

## Decisions still required

Before implementation depends on them, maintainers must decide:

1. The issue and pull request states, manual repair policy, and legacy mappings.
2. TypeScript and the exact runtime module declaration.
3. Single-replica or durable distributed coordination for the first deployment.
4. The MVP modules and resulting permission and webhook manifest.
5. Whether legacy structured comment markers remain temporarily during migration.
6. Hosting, operational ownership, retention, privacy, and cost.
7. The first SDK pilot and its rollback thresholds.

Detailed contracts, evidence notes, security review, quality gates, and implementation sequencing should follow
these architecture decisions rather than silently settle them.
