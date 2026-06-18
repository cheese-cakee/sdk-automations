# Service Inventory — Hiero Python SDK

> **Audit scope:** the GitHub automation surface under `.github/` of
> [`hiero-ledger/hiero-sdk-python`](https://github.com/hiero-ledger/hiero-sdk-python).
> **Source state:** `main` @ `5df93b7` (2026-06-16).
> **Purpose:** enumerate every maintainer-automation *service* — trigger, behaviour, permissions,
> destructiveness, label/state touchpoints — as the breadth pass for later analysis.

## Architecture at a glance

The Python SDK takes the **opposite approach to C++**: ~42 active workflow files (plus 10 archived),
each owning one narrow concern, wired **directly** to GitHub events with no central dispatcher.

> **Note on the summary table:** triggers are abbreviated to event *types*. Many `push` / `pull_request`
> rows are additionally **branch-filtered** (usually to `main`) and/or **path-filtered** in the source;
> consult the workflow file for exact scoping. Destructive classification and label facts below were
> cross-checked against the scripts.

- Logic lives in `.github/scripts/` — JavaScript for event bots, **Bash** (`.sh`) for cron sweeps,
  some Python utilities. YAML files are thin routers.
- The only shared config layer is the label-constants modules `scripts/shared/labels.js` and
  `scripts/labels.js` — **there is no single policy file** like C++'s `hiero-automation.json`. Most
  thresholds, anchors, excluded-author lists, and team slugs are inlined per script.
- External state files gate behaviour: `.github/spam-list.txt` (assignment gating) and
  `.github/mentor_roster.json` (mentor rotation).
- The surface clusters into: **contributor ladder** (GFI → beginner → intermediate → advanced),
  **lifecycle/inactivity**, **PR quality gates**, **admin cron maintenance**, **notifications**,
  **review-queue label sync**, and **CI/security**.
- Two flows use the **fork-safe two-workflow artifact relay** (`workflow_run`): linked-issue label
  sync (compute/apply) — mirroring the C++ review-label pattern.

## Summary

| Service | File(s) | Group | Trigger | Destructive? |
|---|---|---|---|---|
| Advanced Requirement Check | `bot-advanced-check.yml` | Assignment | `issues` assigned/labeled, dispatch | **Yes** — unassign |
| Assignment Limit Enforcer | `bot-assignment-check.yml` | Assignment | `issues` assigned | **Yes** — unassign |
| Beginner `/assign` Handler | `bot-beginner-assign-on-comment.yml` | Assignment | `issue_comment` | No |
| GFI `/assign` Handler | `bot-gfi-assign-on-comment.yml` | Assignment | `issue_comment` | No |
| Intermediate Assignment Guard | `bot-intermediate-assignment.yml` | Assignment | `issues` assigned, dispatch | **Yes** — unassign |
| Reviewer→Assignee (PR) | `on-review.yml` | Assignment | `pull_request_target` review_requested | No |
| `/unassign` | `unassign-on-comment.yml` | Slash Commands | `issue_comment` | **Yes** — unassign |
| `/working` | `working-on-comment.yml` | Slash Commands | `issue_comment`, dispatch | No |
| Issue Approval | `approved-issues.yml` | Lifecycle | `issues` labeled (`approved`) | **Yes** — unlock, remove label |
| New Issue Moderation | `moderate-new-issues.yml` | Moderation | `issues` opened | **Yes** — lock issue |
| Inactivity Unassign | `bot-inactivity-unassign.yml` | Lifecycle | `schedule`, dispatch | **Yes** — unassign, close PR |
| GFI Candidate Notification | `bot-gfi-candidate-notification.yaml` | Notifications | `issues` labeled | No |
| P0 Issue Team Alert | `bot-p0-issues-notify-team.yml` | Notifications | `issues` labeled | No |
| CodeRabbit Plan Trigger | `bot-coderabbit-plan-trigger.yml` | Notifications | `issues` labeled | No |
| Community Call Reminder | `cron-calls-community.yml` | Notifications | `schedule`, dispatch | No |
| Office Hours Reminder | `cron-calls-office-hours.yml` | Notifications | `schedule`, dispatch | No |
| Issue No-PR Reminder | `cron-reminder-issue-no-pr.yml` | Notifications | `schedule`, dispatch | No |
| PR Inactivity Reminder | `cron-reminder-pr-inactive.yml` | Notifications | `schedule`, dispatch | No |
| Workflow Failure Notifier | `pr-check-feedback-all.yml` | Notifications | `workflow_run` completed | No |
| PR Broken Links (per-PR) | `pr-check-primary-broken-links.yml` | PR Quality | `push`/`pull_request` (md) | No |
| Cron Broken Links (monthly) | `cron-pr-check-broken-links.yml` | PR Quality | `schedule`, dispatch | No (creates issues) |
| Test File Naming Check | `pr-check-primary-test-files.yml` | PR Quality | `push`/`pull_request` (tests) | No |
| Linked Issue Enforcer | `cron-enforcer-pr-linked-issue.yml` | PR Quality | `schedule`, dispatch | **Yes** — close PR |
| Triage Review Request | `request-triage-review.yml` | Labels | `pull_request_target` opened/labeled | No |
| Review Queue Label Sync | `review-sync.yml` | Labels | `schedule` */30, dispatch | No (label writes) |
| Linked Issue Label Sync (compute) | `sync-issue-labels-compute.yml` | Labels | `pull_request` | No |
| Linked Issue Label Sync (apply) | `sync-issue-labels-add.yml` | Labels | `workflow_run` completed | No |
| Spam List Maintenance | `cron-admin-update-spam-list.yml` | Moderation | `schedule` hourly, dispatch | No (creates issues) |
| Next Issue Recommendation | `bot-next-issue-recommendation.yml` | Recommendation | `pull_request_target` closed | No |
| PyPI Publish | `publish.yml` | Release/Publish | `push` tags `v*.*.*` | No |
| CodeRabbit Release Gate | `release-pr-coderabbit-gate.yml` | Release/Publish | `pull_request` (release PRs) | No |
| Code Coverage (Codecov) | `pr-check-primary-codecov.yml` | Build/CI | `push`/`pull_request` | No |
| CodeQL Analysis | `pr-check-primary-codeql.yml` | Security | `push`/`pull_request`/`schedule` | No |
| ClusterFuzzLite | `clusterfuzzlite.yml` | Security | `pull_request`/`push` | No |
| Dependency Compatibility | `pr-check-secondary-deps-test.yml` | Build/CI | `push`/`pull_request`/dispatch | No |
| Examples Execution | `pr-check-secondary-examples.yml` | Build/CI | `push`/`pull_request`/dispatch | No |
| TCK Unit Tests | `pr-check-secondary-tck-test.yml` | Build/CI | `push`/`pull_request`/dispatch | No |
| Unit & Integration Tests | `pr-check-secondary-unit-integration-test.yml` | Build/CI | `push`/`pull_request`/dispatch | No |
| Pre-commit Checks | `pre-commit.yml` | Build/CI | `push`/`pull_request` | No |
| Test — On Review Bot | `test-on-review.yml` | Build/CI | `pull_request`, dispatch | No |
| Test — Review Sync | `test-review-sync.yml` | Build/CI | `push`/`pull_request` | No |

**Seven destructive services** (vs. two in C++): three assignment guards that unassign, `/unassign`,
the inactivity sweep, the linked-issue enforcer (closes PRs), and the moderation lock/unlock pair.
Only the inactivity flows use an age threshold (no warn→act grace pattern as clean as C++'s).

---

## Assignment — the contributor ladder

The python SDK encodes a **skill progression ladder** as a chain of guards:
`Good First Issue → skill: beginner → skill: intermediate → skill: advanced`. Each level's assignment
is gated on a count of *closed issues at the previous level*. Core-team permission levels
(admin/maintain/write/triage) bypass the guards.

### Advanced Requirement Check — `bot-advanced-check.yml`
- **Trigger:** `issues` `assigned`/`labeled`; `workflow_dispatch` (`dry_run`, `username`).
- **Does:** On `skill: advanced` assign, `bot-advanced-check.sh` counts the assignee's closed
  `skill: intermediate` issues; if `< 1`, comments (`<!-- advanced-check:unqualified -->`) and
  **removes the assignee**. Core team exempt.
- **Perms:** `contents: read`, `issues: write`. **Destructive?** **Yes** — unassign, no grace; comment deduped.
- **Labels — read:** `skill: advanced`, `skill: intermediate`. **Toggle:** `dry_run` on dispatch.
- **Shared:** `scripts/bot-advanced-check.sh`.

### Assignment Limit Enforcer — `bot-assignment-check.yml`
- **Trigger:** `issues` `assigned`.
- **Does:** `bot-assignment-check.sh` cross-checks the assignee against `.github/spam-list.txt`
  (spam users: GFI only, cap 1; normal: cap 2 open). Violations → **immediate unassign** + explanatory
  comment. **Exemption differs from the skill guards:** only `admin`/`write` are fully exempt here
  (not `triage`/`maintain`); `triage` users instead get special handling — `notes: mentor-duty` issues
  are excluded from their count.
- **Perms:** `issues: write`. **Destructive?** **Yes** — unassign, no grace.
- **Labels — read:** `Good First Issue`, `notes: mentor-duty`. **Toggle:** none.
- **Shared:** `scripts/bot-assignment-check.sh`, `.github/spam-list.txt`.

### Beginner `/assign` Handler — `bot-beginner-assign-on-comment.yml`
- **Trigger:** `issue_comment` `created` (beginner-labeled issues).
- **Does:** On `/assign`, verifies ≥1 closed GFI via GraphQL; if not, posts `<!-- beginner-gfi-guard -->`
  and **blocks** (does not unassign). Posts a one-time hint on non-`/assign` comments. 2-issue cap;
  spam users blocked.
- **Perms:** `issues: write`, `contents: read`. **Destructive?** No.
- **Labels — read:** `skill: beginner`, `Good First Issue`.
- **Shared:** `scripts/bot-beginner-assign-on-comment.js`, `scripts/shared/labels.js`, `.github/spam-list.txt`.

### GFI `/assign` Handler — `bot-gfi-assign-on-comment.yml`
- **Trigger:** `issue_comment` `created` (GFI-labeled issues; repo-wide concurrency).
- **Does:** On `/assign`, posts a "taken" comment if already assigned; else enforces caps (spam 1 /
  normal 2) and assigns, then **synchronously chains** two bots: `bot-mentor-assignment.js` (mentor
  rotation from `mentor_roster.json` + first-timer welcome) and `coderabbit_plan_trigger.js`
  (`@coderabbitai plan`). One-time hint on non-`/assign` comments.
- **Perms:** `issues: write`, `contents: read`. **Destructive?** No.
- **Labels — read:** `Good First Issue`. **Toggle:** `DRY_RUN = (owner != hiero-ledger)`.
- **Shared:** `bot-gfi-assign-on-comment.js`, `bot-mentor-assignment.js`, `coderabbit_plan_trigger.js`, `shared/labels.js`, `mentor_roster.json`, `spam-list.txt`.

### Intermediate Assignment Guard — `bot-intermediate-assignment.yml`
- **Trigger:** `issues` `assigned`; `workflow_dispatch` (`dry_run`).
- **Does:** On `skill: intermediate` assign, counts closed `skill: beginner` issues; `< 1` →
  **unassign** + `<!-- Intermediate Issue Guard -->` comment. Core team exempt.
- **Perms:** `issues: write`, `contents: read`. **Destructive?** **Yes** — unassign. **Toggle:** `dry_run`.
- **Labels — read:** `skill: intermediate`, `skill: beginner`.
- **Shared:** `bot-intermediate-assignment.js`, `shared/labels.js`.

### Reviewer→Assignee (PR) — `on-review.yml`
- **Trigger:** `pull_request_target` `review_requested`; `workflow_dispatch` (`pr_number`).
- **Does:** Assigns requested individual reviewers (teams ignored) as PR assignees, capped at 2 total.
- **Perms:** `contents: read`, `pull-requests: write`, `issues: write`. **Destructive?** No.
- **Shared:** `bot-pr-add-reviewers-as-assignees.js`, `shared/helpers/reviewers-assignee-index.js`.

---

## Slash Commands

### `/unassign` — `unassign-on-comment.yml`
- **Trigger:** `issue_comment` `created` (issues only).
- **Does:** Only the current assignee can trigger; checks for prior `<!-- unassign-requested:<user> -->`
  marker (idempotent); removes the user from assignees + confirmation comment.
- **Perms:** `issues: write`, `contents: read`. **Destructive?** **Yes** — user-initiated unassign.
- **Shared:** `bot-unassign-on-comment.js`.

### `/working` — `working-on-comment.yml`
- **Trigger:** `issue_comment` `created`; `workflow_dispatch` (`dry_run`).
- **Does:** From the current assignee (issue) or PR author (PR), adds an `eyes` reaction. `/working`
  is the **inactivity-timer reset signal** read by `bot-inactivity-unassign.sh` and
  `cron-reminder-issue-no-pr.sh`.
- **Perms:** top-level `contents: read`; `issues: write` is a **job-level** override on the command job.
  **Destructive?** No. **Toggle:** `dry_run`.
- **Shared:** `bot-working-on-comment.js`.

---

## Lifecycle / Moderation

### New Issue Moderation — `moderate-new-issues.yml`
- **Trigger:** `issues` `opened`.
- **Does:** Adds `pending-review`, comments tagging triage/committers/maintainers, and **locks the
  issue** (`off-topic`) to prevent premature discussion. Lock lifted by `approved-issues.yml`.
- **Perms:** `issues: write`. **Destructive?** **Yes** — locks issue on creation.
- **Labels — write:** add `pending-review`. **Shared:** inline `gh` CLI.

### Issue Approval — `approved-issues.yml`
- **Trigger:** `issues` `labeled` (`approved`).
- **Does:** Removes `pending-review`, **unlocks** the issue, comments confirming approval.
- **Perms:** `issues: write`. **Destructive?** **Yes** — unlock + label removal (reverses moderation lock).
- **Labels — read:** `approved`; **remove:** `pending-review`. **State:** `pending-review` → `approved`.

### Inactivity Unassign — `bot-inactivity-unassign.yml`
- **Trigger:** `schedule` `0 12 * * *`; `workflow_dispatch` (`dry_run`). **21-day** threshold.
- **Does:** `bot-inactivity-unassign.sh`. Phase 1 — assigned issues with no linked open PR: if assigned
  ≥21 days and no `/working` in 21 days → **unassign** + comment. Phase 2 — assigned issues with linked
  open PRs: if last commit ≥21 days old and PR lacks `discussion` label → **close the PR**, unassign,
  comment.
- **Perms:** `contents: read`, `issues: write`, `pull-requests: write`.
- **Destructive?** **Yes** — unassign + close PR; threshold is the only buffer; `/working` resets it.
- **Labels — read:** `discussion` (skip). **Toggle:** `dry_run` (cron always live).
- **Shared:** `bot-inactivity-unassign.sh`.

---

## PR Quality Checks

### Linked Issue Enforcer — `cron-enforcer-pr-linked-issue.yml`
- **Trigger:** `schedule` `0 2 * * *`; `workflow_dispatch` (`dry_run`).
- **Does:** For each open non-bot PR open ≥24h: checks for a linked open issue (GraphQL
  `closingIssuesReferences`) **and** that the author is assigned to it; if `no_issue`/`not_assigned`,
  comments and **closes the PR**.
- **Perms:** `pull-requests: write`, `contents: read`. **Destructive?** **Yes** — close PR (24h age only).
- **Toggle:** `dry_run`. **Shared:** `cron-enforcer-pr-linked-issue.js`.

### Test File Naming Check — `pr-check-primary-test-files.yml`
- **Trigger:** `push`/`pull_request` on `tests/**`. Fails if any tracked test file (excl.
  `conftest.py`, `__init__.py`) doesn't end with `_test.py`. **Perms:** `contents: read`.
- **Shared:** `pr-check-test-files.js`.

### PR Broken Links (per-PR) — `pr-check-primary-broken-links.yml`
- **Trigger:** `push`/`pull_request` on `**/*.md`. Runs `tcort/github-action-markdown-link-check` on
  changed files. **Perms:** `contents: read`.

### Cron Broken Links (monthly) — `cron-pr-check-broken-links.yml`
- **Trigger:** `schedule` `0 0 1 * *`; `workflow_dispatch` (`dry_run`). Runs `lychee` repo-wide; creates
  or updates a tracking issue (`notes: broken markdown links`, `notes: automated`).
- **Perms:** `contents: read`, `issues: write`. **Destructive?** No (creates/updates issues).
- **Shared:** `scripts/labels.js`.

---

## Labels

### Review Queue Label Sync — `review-sync.yml`
- **Trigger:** `schedule` `*/30 * * * *`; `workflow_dispatch` (`dry_run`).
- **Does:** For all open non-draft PRs, applies a single queue label by approval state —
  `queue:junior-committer` → `queue:committers` → `queue:maintainers` → `status: ready-to-merge`
  (1 maintainer + 2 core approvals) — and always ensures `open to community review`. Adds target
  then removes stale labels (crash-safe). Aborts if rate-limit `< 200`.
- **Perms:** `pull-requests: write`, `issues: write`, `contents: read`, `checks: read`.
- **Destructive?** No (label writes only). **Toggle:** `dry_run`.
- **State machine:** owns the full PR review-queue state machine. **Shared:** `scripts/review-sync/`.

### Linked Issue Label Sync (compute + apply) — `sync-issue-labels-compute.yml` + `sync-issue-labels-add.yml`
- **Trigger:** compute on `pull_request`; apply on `workflow_run` completed.
- **Does:** Fork-safe relay. Compute (read-only, on `pull_request` opened/edited/reopened/synchronize):
  parses the PR body with an inline **regex** over `fix|close|resolve (#N)` keywords (note: not the
  GraphQL `closingIssuesReferences` the Linked Issue Enforcer uses), diffs linked-issue labels vs PR
  labels, writes `labels.json` artifact. Apply (privileged): downloads artifact and **adds** labels
  (purely additive, never removes).
- **Perms:** compute `issues: read`, `contents: read`; apply `pull-requests: write`, `issues: write`, `actions: read`.
- **Destructive?** No. **Shared:** inline JS.

### Triage Review Request — `request-triage-review.yml`
- **Trigger:** `pull_request_target` `opened`/`labeled` (when PR has `Good First Issue` / `skill: beginner`
  / `beginner`). Posts idempotent `<!-- triage -->` comment mentioning the triage team.
- **Perms:** `contents: read`, `pull-requests: write`. **Destructive?** No.

---

## Notifications / Reminders

| Service | Cron | Targets | Notes |
|---|---|---|---|
| GFI Candidate Notification (`bot-gfi-candidate-notification.yaml`) | on label | issue | tags GFI support team; `DRY_RUN` if owner≠hiero-ledger |
| P0 Issue Team Alert (`bot-p0-issues-notify-team.yml`) | on label | issue | `priority: critical`/`Priority: Critical`; deduped |
| CodeRabbit Plan Trigger (`bot-coderabbit-plan-trigger.yml`) | on skill label | issue | posts `@coderabbitai plan` once |
| Community Call Reminder (`cron-calls-community.yml`) | `0 10 * * 3` | issues | fortnightly (anchor 2025-11-12); excluded authors |
| Office Hours Reminder (`cron-calls-office-hours.yml`) | `0 10 * * 3` | PRs | fortnightly (anchor 2025-12-03); same excludes |
| Issue No-PR Reminder (`cron-reminder-issue-no-pr.yml`) | `0 13 * * *` | issues | 7-day; reset by `/working`; pre-step to unassign |
| PR Inactivity Reminder (`cron-reminder-pr-inactive.yml`) | `0 11 * * *` | PRs | 10-day; pre-step to unassign |
| Workflow Failure Notifier (`pr-check-feedback-all.yml`) | `workflow_run` | PR | reacts to 7 named check workflows; deduped |

All are non-destructive (comment-only). The two fortnightly reminders share cron + logic and hard-code
the same excluded-author list — a duplication candidate.

---

## Recommendation / Release / CI / Security

- **Next Issue Recommendation** (`bot-next-issue-recommendation.yml`) — on merged PR, recommends the
  next issue along a 5-tier ladder (level-up → cross-repo → same-level → below). `shared/` CONFIG.
- **PyPI Publish** (`publish.yml`) — on `v*.*.*` tags; build + Sigstore sign + OIDC publish + attestations.
  Top-level `contents: read`; the `build` job adds `id-token: write` + `attestations: write`, and the
  `publish-and-sign` job adds `contents: write` (the one privileged exception in the whole surface).
- **CodeRabbit Release Gate** (`release-pr-coderabbit-gate.yml`) — posts `@coderabbit review` on release
  PRs with an audit prompt from `.github/coderabbit/release-pr-prompt.md`.
- **Build/CI:** Code Coverage (Codecov), Dependency Compatibility (3.10/3.14 lowest-direct), Examples
  Execution (Hiero Solo), TCK Unit Tests, Unit & Integration Tests (3.10–3.14 + Solo), Pre-commit.
- **Security:** CodeQL (actions + python, `security-extended`, daily), ClusterFuzzLite (ASan fuzzing).
- **Self-test:** `test-on-review.yml`, `test-review-sync.yml` unit-test the bot scripts in CI.

---

## Appendix A — Archived workflows (`.github/workflows/archive/`)

Present but inactive — useful for "retired services" classification on Day 2:
`bot-gfi-notify-team.yml`, `bot-mentor-assignment.yml`, `bot-merge-conflict.yml`,
`bot-pr-auto-draft-on-changes.yml`, `bot-pr-linked-issue-not-assigned.yml`,
`bot-pr-missing-linked-issue.yml`, `bot-verified-commits.yml`, `pr-check-title.yml`,
`bot-pr-draft-explainer.yaml`, `bot-pr-draft-ready-reminder.yaml` (**10 files total**).
Note: `scripts/bot-conventional-pr-title.js` still exists but has **no active workflow** (dead code).

## Appendix B — Label strings referenced

**Skill/difficulty:** `Good First Issue`, `Good First Issue Candidate` / `good first issue candidate`,
`skill: beginner` (+ legacy alias `beginner`), `skill: intermediate`, `skill: advanced`
**Priority:** `priority: critical` (+ case variant `Priority: Critical`)
**Review queue:** `queue:junior-committer`, `queue:committers`, `queue:maintainers`,
`status: ready-to-merge`, `open to community review`
**Lifecycle:** `pending-review`, `approved`
**Notes/admin:** `notes: broken markdown links`, `notes: automated`, `notes: spam`,
`notes: spam-list-update`, `notes: mentor-duty`
**Misc:** `discussion` (inactivity skip)

## Appendix C — Overlap / duplication notes (feeds Day 4 coupling analysis)

1. Two fortnightly reminders (`cron-calls-community`, `cron-calls-office-hours`) share cron + logic +
   excluded-author list.
2. Four `issue_comment` workflows (GFI assign, beginner assign, `/unassign`, `/working`) all fire on
   every issue comment and filter by label/command in-job → concurrent runs per comment.
3. `/working` detection is duplicated across `bot-inactivity-unassign.sh` and
   `cron-reminder-issue-no-pr.sh` rather than shared.
4. Label-alias drift risk: `beginner` vs `skill: beginner`, `Priority: Critical` vs `priority: critical`,
   `Good First Issue` casing — checked inconsistently across scripts.
5. `pr-check-feedback-all.yml` matches 7 workflows by **exact name string** — renames silently break it.
6. Two workflows use `workflow_run`: linked-issue label sync (for fork-safe **privilege separation**)
   and `pr-check-feedback-all.yml` (reacting to 7 named check workflows — notification only, not
   privilege separation).

> **Key contrast for the decoupling work:** Python's behaviour is *config-by-convention* — thresholds,
> anchors, team slugs, and label strings are scattered across ~40 files and their scripts, with several
> case/alias inconsistencies. C++ has already centralised all of this into one `hiero-automation.json`.
> A shared policy schema will need to absorb both, normalising the label taxonomy in the process.
