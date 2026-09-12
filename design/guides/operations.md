# Operations — what runs today

> **What runs, and who has to be able to run it.** The shell verifies and durably accepts
> deliveries, persists one canonical report, and exposes process, repository, capability and item
> stop controls. Alerting, backups, reconciliation and runbooks are unbuilt, and the operator
> surfaces that would need them are not described here. Measured answers live in [`../findings/`](../findings/).

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

The records that role owns: the canonical delivery report (what was decided and why) and the effect
journal (what reached GitHub). Neither carries a secret or repository content it does not need, and
**repository comments are user-facing output, never the operational audit record.** How long either
is kept, who may read it, and how it is deleted are open (Q17) — ninety days was proposed under D43
and never ratified — so the store still grows without a policy.

## 2. Intake

- **The production receiver terminates GitHub's POST directly.** No relay, tunnel, or forwarding tier.
- Protocol 6.2 showed why: an acknowledging relay is structurally an ack-first receiver.
- GitHub's ledger then records `OK` for deliveries the receiver never saw.
- That recreates P9's loss window somewhere no process discipline can reach.
- Relays are acceptable only in ring-zero development.

## 3. Pacing

- **The adapter is the only component handling rate-limit and retry behaviour.**
- **Capabilities never implement a private retry loop.**
- The adapter records primary and secondary rate-limit headers.
- It uses conditional reads where supported and paginates every list operation.
- It paces writes and applies bounded backoff.
- It stops retrying when GitHub's response says waiting is required.
- Measured budgets (Q10):
  [`../findings/endpoint-permission-matrix.md`](../findings/endpoint-permission-matrix.md).

## 4. Kill switches

| Switch | Stops | Built |
|---|---|---|
| Process/global | every returned intent after capability/resolver evaluation | `KILL_SWITCH=1`; intake still records and reports the refusal |
| Installation | one organization or installation | no |
| Repository mode | one repository's approved effects | all four modes are core vocabulary; a process composed without the App's identity records `modeUnsupported` for `active` |
| Capability | one capability, leaving others alone | `capabilities.<name>.enabled: false` or omission |
| Item-level pause | every capability write on an item | mapped `blocked` meaning → `itemBlocked` |

- Four of the five levels have code paths today; installation-wide suspension is missing. The process
  switch is an intent-level safety refusal, not a transport or evaluation shutdown; an unsupported
  `active` is intercepted earlier still, before `decide()` runs. The item pause is currently global to
  all capabilities rather than profile-selective (D117).
- The operator runbook must say what happens to queued and pending work when each switch activates.

## 5. Before the App writes to a repository it does not own

- Old and new automation must never write the same managed state at the same time (Q7).
- Every pilot repository needs an inventory first: old triggers · permissions · state writes ·
  effect writes · how the old writer is disabled · how the change is rolled back.
- A migration mapping may translate old labels or fields into internal meanings. It stays specific to
  that repository and never becomes universal platform policy.
- A renamed mapped label stops that capability's label work and is reported; the App does not
  recreate the old label, guess the new name, or change existing items.
