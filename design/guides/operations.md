# Operations

> **Partly built, not production-ready.** The shell already verifies and durably accepts deliveries,
> persists one canonical report, and exposes process/repository/capability/item stop controls. A production
> operator, live adapter, alerting, backups, retention, reconciliation, and runbooks remain unbuilt. Measured
> answers live in [`../findings/`](../findings/); sequencing lives in
> [`../build-plan.md`](../build-plan.md).

## 1. The operator

Whoever takes the operator role must be able to:

- store and rotate the App private key and the webhook secret;
- control deployment, kill switches, storage, backups, and retention;
- monitor webhook delay, queue depth, API limits, failures, and reconciliation;
- suspend processing without uninstalling the App;
- prove whether one or several application processes are active.

- One deployment gives every repository the same configuration, permissions, adapter, and upgrades.
- It needs an organization-owned operator, not one contributor's personal account (Q1, Q13).
- A personal development App is separate from the production App (P8).
- The personal App is only ever used for sandbox work.

## 2. Intake

- **The production receiver terminates GitHub's POST directly.** No relay, tunnel, or forwarding tier.
- Protocol 6.2 showed why: an acknowledging relay is structurally an ack-first receiver.
- GitHub's ledger then records `OK` for deliveries the receiver never saw.
- That recreates P9's loss window somewhere no process discipline can reach.
- Relays are acceptable only in ring-zero development.

## 3. Process and coordination

- Whether the first production version runs one process or several is open.
- D18 answers it for business-hours operation; Q17 carries the rest.
- Whichever is chosen must define **deployment overlap and restart behaviour**.
- It must define **poison-item handling and how pending work transfers to a new process**.
- Current-state checks alone do not stop two processes deciding oppositely from one stale read.

## 4. Pacing

- **The adapter is the only component handling rate-limit and retry behaviour.**
- **Capabilities never implement a private retry loop.**
- The adapter records primary and secondary rate-limit headers.
- It uses conditional reads where supported and paginates every list operation.
- It paces writes and applies bounded backoff.
- It stops retrying when GitHub's response says waiting is required.
- Measured budgets (Q10):
  [`../findings/endpoint-permission-matrix.md`](../findings/endpoint-permission-matrix.md).

## 5. Failure audiences

| Failure | Primary audience | Candidate channel |
|---|---|---|
| Invalid or outdated configuration | maintainer, config author | a configuration report |
| A capability lacks a permission | repository or installation owner | effective-configuration report |
| A command is refused or unclear | the person who issued it | acknowledgement, updated with facts |
| Repeatedly invalid intent | capability developer, operator | telemetry, no repeated comments |
| Sustained delivery or queue delay | the operator | metrics, an alert naming the delay |
| Sustained GitHub service failure | the operator | the adapter pauses unsafe retries |
| An item repeatedly crashes | the operator | the queue isolates it for safe replay |
| An unprovable write | operator, affected command user | the recovery record |

- Every failure class has one primary audience and a clear next step.
- **The App must not comment for every internal retry or temporary GitHub failure.**
- The configuration report's final form depends on permissions.
- The effective-configuration report names the missing permission and the blocked operations.
- The acknowledgement also gives a safe next step; the alert also names the installation.
- A sustained GitHub failure reaches the repository only when user-visible service is affected.
- The recovery record states the observed postcondition and the next reconciliation step.

## 6. Audit records and retention

- One audit record should connect the whole chain: normalized observation · effective configuration
  revision · capability decision · typed intent · policy result · adapter calls · outcome · recovery.
- The canonical delivery report covers the first half of that chain today.
- The adapter and recovery halves do not exist.
- An audit record carries no secrets and no unnecessary repository content.
- Retention period, access control, and deletion process are open (Q17).
- Whether public and private repositories need different handling is open too.
- Ninety days was proposed for the delivery and journal tables under D43, and never ratified.
- Repository comments are user-facing output, never the operational audit record.

## 7. Kill switches

| Switch | Stops | Built |
|---|---|---|
| Process/global | every returned intent after capability/resolver evaluation | `KILL_SWITCH=1`; intake still records and reports the refusal |
| Installation | one organization or installation | no |
| Repository mode | one repository's approved effects | all four modes are core vocabulary; the current shell additionally rejects `active` |
| Capability | one capability, leaving others alone | `capabilities.<name>.enabled: false` or omission |
| Item-level pause | every capability write on an item | mapped `blocked` meaning → `itemBlocked` |

- Four of the five levels have code paths today; installation-wide suspension is missing. The process
  switch is an intent-level safety refusal, not a transport or evaluation shutdown; `active` is intercepted
  even earlier as unsupported. The item pause is currently global to all capabilities rather than
  profile-selective (D117).
- The operator runbook must say what happens to queued and pending work when each switch activates.

## 8. Migration

- Old and new automation must never write the same managed state at the same time (Q7).
- Every pilot repository needs an inventory before the App writes anything.
- Inventory: old triggers · permissions · state writes · effect writes · disablement · rollback.
- A migration mapping may translate old labels or fields into internal meanings.
- It stays specific to that repository and never becomes universal platform policy.
