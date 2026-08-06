# Service Inventory — Hiero C++ SDK

> **Audit scope:** the GitHub automation surface under `.github/` of
> [`hiero-ledger/hiero-sdk-cpp`](https://github.com/hiero-ledger/hiero-sdk-cpp).
> **Source state:** `main` @ `a898153` (2026-05-14).
> **Purpose:** enumerate every maintainer-automation *service*, its trigger, behaviour,
> permissions, destructiveness, and label/state touchpoints — the breadth pass that feeds the
> later relationship, label, and coupling analyses.
>
> A *service* here is a distinct maintainer-automation capability (PR checks, assignment,
> inactivity reaping, slash commands, scheduled builds, …). Reusable (`zxc-*`) and build/CI
> workflows are listed as services too.

## Architecture at a glance

The C++ SDK automation is a **hub-and-spoke event system**:

- Thin workflow files fire on GitHub events (`pull_request_target`, `pull_request_review`,
  `issue_comment`, `schedule`, `workflow_run`) and on a reusable `workflow_call`.
- Each workflow checks out the **default branch only** (never PR-branch code) and calls a JS
  handler via `actions/github-script`.
- All handlers import one shared barrel, `.github/scripts/helpers/index.js`, which re-exports
  `constants.js`, `api.js`, `checks.js`, `comments.js`, `logger.js`, `validation.js`.
- **Every label string, team slug, limit, prerequisite, and doc URL lives in a single policy
  file, `.github/hiero-automation.json`**, loaded by `helpers/config-loader.js`, schema-validated,
  and exposed as frozen constants. This is the centralisation the wider project is trying to
  generalise.
- The PR-review label flow uses a **two-workflow artifact relay** (`on-pr-review.yaml` captures the
  event to an artifact; `on-pr-review-labels.yaml` consumes it via `workflow_run`) so fork-review
  events get a write token without ever executing untrusted code.

## Summary

| # | Service | Group | Trigger | Destructive? |
|---|---------|-------|---------|--------------|
| 1 | PR Open Checks & Auto-Assign | PR Quality Checks | `pull_request_target` opened/reopened/ready_for_review | No |
| 2 | PR Update Checks | PR Quality Checks | `pull_request_target` synchronize/edited | No |
| 3 | PR Review Label Relay (capture) | Labels | `pull_request_review` submitted | No |
| 4 | PR Review Label Applicator | Labels | `workflow_run` completed | No |
| 5 | Post-Merge Recommendation & Milestone | Recommendation | `pull_request_target` closed (merged) | No |
| 6 | Sibling Conflict Re-check on Merge | PR Quality Checks | `pull_request_target` closed (merged) | No |
| 7 | Slash Command Dispatcher | Slash Commands | `issue_comment` created | No |
| 8 | `/assign` | Assignment | `issue_comment` created | No |
| 9 | `/unassign` | Assignment | `issue_comment` created | **Yes** — unassigns, reverts label |
| 10 | `/finalize` | Slash Commands | `issue_comment` created | No |
| 11 | Inactivity Reaper | Lifecycle/Inactivity | `schedule` daily + dispatch | **Yes** — closes/unassigns/resets |
| 12 | Scheduled Builds | Build/CI | `schedule` daily + dispatch | No |
| 13 | PR Build & Link Check | Build/CI | `pull_request` + dispatch | No |
| 14 | Reusable Build Library | Build/CI | `workflow_call` + dispatch | No |
| 15 | Reusable Workflow Linter | Build/CI | `pull_request` (path-filtered) + dispatch | No |
| 16 | Bot Script CI Tests | Build/CI | `pull_request` (path-filtered) + dispatch | No |

**Two services are destructive** (`/unassign`, Inactivity Reaper). The reaper is the only one with
a built-in grace period (5-day warning → 7-day action). `/unassign` is user-initiated and immediate.

---

## PR Quality Checks

### 1. PR Open Checks & Auto-Assign
- **Workflow:** `on-pr.yaml` → `scripts/bot-on-pr-open.js`
- **Trigger:** `pull_request_target` `opened`, `reopened`, `ready_for_review`; only when `draft == false`.
- **What it does:** Auto-assigns the PR author if unassigned (this runs even for bot-authored PRs);
  then, for non-bot PRs only, fetches all commits and runs the **four checks** — DCO sign-off (regex per non-merge commit), GPG
  (`verification.verified` per commit), merge-conflict (`mergeable` polled up to 5×), issue-link
  (body + GraphQL scan with assignee verification); posts/updates the unified `<!-- bot:pr-helper -->`
  dashboard comment; then **force-applies** `status: needs review` or `status: needs revision`
  regardless of prior state.
- **Permissions:** `pull-requests: write`, `contents: read`, `checks: write`
- **Destructive?** No.
- **Labels — write:** `status: needs review`, `status: needs revision`.
- **State machine:** first status write for a PR (entry into the review sub-machine).
- **Toggle:** none; the `draft == false` guard silently skips drafts.
- **Shared:** `helpers/api.js`, `helpers/checks.js`, `helpers/comments.js`, `helpers/constants.js`, `hiero-automation.json`.

### 2. PR Update Checks
- **Workflow:** `on-pr-update.yaml` → `scripts/bot-on-pr-update.js`
- **Trigger:** `pull_request_target` `synchronize`, `edited`; only when `draft == false`.
- **What it does:** Skips bot PRs; for `edited` exits early unless `changes.body` is present (title/base
  edits ignored); re-runs the four checks and updates the dashboard; swaps the status label **only if
  the opposite status label is already present** (no `force`) — so a PR with neither label is left
  unchanged.
- **Permissions:** `contents: read`, `pull-requests: write`, `checks: write`
- **Destructive?** No.
- **Labels — read/write:** `status: needs review` ↔ `status: needs revision`.
- **State machine:** transitions between the two review states, conditional on one already being set.
- **Shared:** same as #1.

### 6. Sibling Conflict Re-check on Merge
- **Workflow:** `on-pr-close.yaml` (job `on-pr-merged-conflict-check`) → `scripts/bot-on-pr-merged.js`
- **Trigger:** `pull_request_target` `closed`; job runs only when `merged == true`.
- **What it does:** Fetches all other open non-draft PRs; re-checks each one's `mergeable` state and
  compares it against what its dashboard comment currently shows (`:x: **Merge Conflicts**`). If a
  PR's conflict state changed, re-runs all four checks + swaps its status label; if the merge
  *introduced* a new conflict, also posts a standalone notification mentioning the affected PR author.
- **Permissions:** inherits `on-pr-close.yaml`'s top-level block — `pull-requests: write`,
  `issues: write`, `contents: read` (no `actions: read`).
- **Destructive?** No.
- **Labels — read/write:** `status: needs review` ↔ `status: needs revision` (on sibling PRs).
- **Shared:** `helpers/api.js`, `helpers/checks.js`, `helpers/comments.js`.

---

## Labels

### 3. PR Review Label Relay (capture)
- **Workflow:** `on-pr-review.yaml` (no JS)
- **Trigger:** `pull_request_review` `submitted`; only when `draft == false`.
- **What it does:** Serialises the review event (`pr_number`, `review_state`, `draft`) into
  `review-event.json` and uploads it as an artifact (1-day retention). Pure capture stage of the
  fork-safe relay; carries **no write permission by design** (`contents: read` only).
- **Destructive?** No. **Labels:** none. **Shared:** none (inline YAML).

### 4. PR Review Label Applicator
- **Workflow:** `on-pr-review-labels.yaml` → `scripts/bot-on-pr-review-labels.js` → `bot-on-pr-review.js`
- **Trigger:** `workflow_run` on *"Bot - On PR Review"* `completed`; only when `conclusion == 'success'`.
- **What it does:** Downloads the artifact, skips drafts, fetches the live PR, reconstructs a
  `pull_request_review`-shaped context, and delegates to `bot-on-pr-review.js`. On a
  `changes_requested` review it force-swaps the status to `status: needs revision`; `approved` /
  `commented` reviews are ignored.
- **Permissions:** `contents: read`, `pull-requests: write`, `issues: write`, `actions: read`.
- **Destructive?** No.
- **Labels — write:** add `status: needs revision`, remove `status: needs review`.
- **State machine:** `needs review` → `needs revision` on requested changes.
- **Shared:** `helpers/api.js`, `helpers/constants.js`, `hiero-automation.json`.

---

## Recommendation

### 5. Post-Merge Issue Recommendation & Milestone
- **Workflow:** `on-pr-close.yaml` (job `on-pr-close`) → `scripts/bot-on-pr-close.js` (+ `bot/bot-recommend-issues.js`)
- **Trigger:** `pull_request_target` `closed`; runs only when `merged == true`.
- **What it does:** (a) `applyMergeMilestoneAutomation` strips all `status:*` labels from the merged PR
  and its linked issues (GraphQL `closingIssuesReferences`), then assigns the latest open milestone to
  the **linked issues** (or to the PR itself only when there are no linked issues — not both); if no
  open milestone exists, comments tagging `maintainerTeam` and exits.
  (b) Skips bot PRs, resolves the linked issue (highest skill level if several), and if it carries a
  skill label, runs the **recommendation engine**: resolves the contributor's true eligible level
  (walk against `skillPrerequisites` + closed-issue counts), detects level-up (`detectUnlockedLevel`),
  batch-fetches up to 50 open `status: ready for dev` + `no:assignee` issues, sorts by
  `priorityHierarchy`, and posts up to 5 recommendations (with a congratulatory block on level-up).
- **Permissions:** `pull-requests: write`, `issues: write`, `contents: read`.
- **Destructive?** No (label removal here is post-merge cleanup, not punitive).
- **Labels — read:** `status: ready for dev`, `skill:*`, `priority:*`; **remove:** all `status:*`.
- **State machine:** terminal — clears status labels from merged items.
- **Shared:** `helpers/api.js`, `helpers/constants.js`, `bot/bot-recommend-issues.js`, `hiero-automation.json`.

---

## Slash Commands & Assignment

### 7. Slash Command Dispatcher
- **Workflow:** `on-comment.yaml` → `scripts/bot-on-comment.js`
- **Trigger:** `issue_comment` `created`, guarded to issue comments only (`issue.pull_request == null`).
- **What it does:** Skips bot comments; parses `/assign`, `/unassign`, `/finalize` (case-insensitive,
  exact match — near-misses get a corrective comment) and dispatches to the command module. Serialised
  per-issue (`concurrency: on-comment-<issue>`, `cancel-in-progress: false`).
- **Permissions:** `issues: write`, `contents: read`.
- **Destructive?** No (dispatcher only). **Shared:** `commands/{assign,unassign,finalize}.js`, `helpers/api.js`, `helpers/logger.js`.

### 8. `/assign`
- **Workflow:** `on-comment.yaml` → `commands/assign.js` `handleAssign`
- **What it does:** Reaction ack → validates (no assignees, `status: ready for dev` present, skill label
  present) → enforces `maxOpenAssignments` (default 2, with a *needs-review bypass* when all assigned
  issues already have a linked `status: needs review` PR) → enforces `maxGfiCompletions` (default 5) for
  `skill: good first issue` → checks skill prerequisites → fresh-fetch race guard → assigns user, posts
  welcome (GFI welcome tags the GFI support team), and transitions `status: ready for dev` → `status: in progress`.
- **Permissions:** `issues: write`, `contents: read`.
- **Destructive?** No.
- **Labels — read:** `status: ready for dev`, `skill:*`, `status: blocked`, `status: needs review`;
  **write:** remove `status: ready for dev`, add `status: in progress`.
- **State machine:** `ready for dev` → `in progress` (core assignment transition).
- **Shared:** `commands/assign-comments.js`, `helpers/api.js`, `helpers/constants.js`, `hiero-automation.json`.

### 9. `/unassign`
- **Workflow:** `on-comment.yaml` → `commands/unassign.js` `handleUnassign`
- **What it does:** Reaction ack → checks issue open, has assignees, commenter is currently assigned →
  removes commenter as assignee, swaps `status: in progress` → `status: ready for dev`, posts success.
- **Permissions:** `issues: write`, `contents: read`.
- **Destructive?** **Yes** — removes assignee and reverts the status label, **immediately, no grace
  period** (user-initiated).
- **Labels — write:** remove `status: in progress`, add `status: ready for dev`.
- **State machine:** `in progress` → `ready for dev` (returns issue to the pool).
- **Shared:** `commands/unassign-comments.js`, `helpers/api.js`, `helpers/constants.js`.

### 10. `/finalize`
- **Workflow:** `on-comment.yaml` → `commands/finalize.js` `handleFinalize`
- **What it does:** Reaction ack → requires commenter to have `triage`/`write`/`maintain`/`admin`
  permission → validates labels (`status: awaiting triage` present, exactly one `skill:`, exactly one
  `priority:`, issue type Bug/Feature/Task) → rewrites the issue title with the correct skill prefix and
  prepends skill boilerplate + standard guide sections to the body → swaps `status: awaiting triage` →
  `status: ready for dev` → posts success.
- **Permissions:** `issues: write`, `contents: read`.
- **Destructive?** No (rewrites title/body; no close/unassign).
- **Labels — read:** `status: awaiting triage`, `skill:*`, `priority:*`; **write:** remove
  `status: awaiting triage`, add `status: ready for dev`.
- **State machine:** `awaiting triage` → `ready for dev` (triage-completion gate).
- **Shared:** `commands/finalize-comments.js`, `helpers/api.js`, `helpers/constants.js`, `hiero-automation.json`.

---

## Lifecycle / Inactivity

### 11. Inactivity Reaper
- **Workflow:** `on-schedule-inactivity.yaml` → `scripts/bot-inactivity.js`
- **Trigger:** `schedule` `0 0 * * *` (daily, midnight UTC) + `workflow_dispatch`.
- **What it does:** Scans open assigned issues and open PRs. PRs: `status: blocked` → 30-day check-in
  ping; `status: needs review` → fully skipped (clock suspended); `status: needs revision` → clock from
  `max(lastActivity, labeled-at)`. Activity = latest of creation, author/assignee comments (on PR or
  linked issues), author commits, `status: blocked` removal. **After 5 days** → idempotent
  `<!-- bot:inactivity-warning -->` comment. **After 7 days** → close the PR, strip `status:*`, remove
  assignees, comment, and reset any linked open issues (`status: ready for dev`). Issues with
  `status: in progress` follow the same 5/7-day thresholds; closure unassigns and resets to
  `status: ready for dev`.
- **Permissions:** `issues: write`, `pull-requests: write`, `contents: read`.
- **Destructive?** **Yes** — closes PRs, unassigns contributors, strips/resets status labels.
  **Grace period: 5-day warning → 7-day action.** `status: blocked` items are exempt from closure.
- **Labels — read:** `status: blocked`, `status: needs review`, `status: needs revision`, `status: in progress`;
  **write:** remove all `status:*`, add `status: ready for dev` (issues only).
- **Toggle:** `workflow_dispatch` (no dry-run flag; runs full logic). `getNow` injectable for tests.
- **Shared:** `helpers/api.js`, `helpers/checks.js`, `helpers/constants.js`, `helpers/logger.js`, `hiero-automation.json`.

---

## Build / CI

### 12. Scheduled Builds
- **Workflow:** `on-schedule-builds.yaml` → calls `zxc-build-library.yaml`
- **Trigger:** `schedule` `0 2 * * *` + `workflow_dispatch`. Calls the reusable build with
  Windows + macOS enabled and `upload-artifacts: false` — a nightly multi-platform health check on `main`.
- **Permissions:** `contents: read`. **Destructive?** No. **Labels:** none.
- **Toggle:** `run-windows-builds` / `run-macos-builds` / `upload-artifacts` inputs.

### 13. PR Build & Link Check
- **Workflow:** `flow-pull-request-checks.yaml` → calls `zxc-build-library.yaml`
- **Trigger:** `pull_request` opened/reopened/synchronize/closed + `workflow_dispatch`. Job `build`
  (skipped on close-without-merge) runs clang-format-17 lint + Debug build + CTest against a live Hiero
  Solo network on Linux, plus Release build/artifact upload on merge. Job `check-links` (open PRs only)
  link-checks modified Markdown via `tcort/github-action-markdown-link-check`.
- **Permissions:** `contents: read`. **Destructive?** No. **Labels:** none.
- **Shared:** `zxc-build-library.yaml`, `.mlc_config.json`.

### 14. Reusable Build Library
- **Workflow:** `zxc-build-library.yaml`
- **Trigger:** `workflow_call` / `workflow_dispatch` with `run-windows-builds`, `run-macos-builds`,
  `upload-artifacts` inputs. Jobs: `lint` (clang-format-17 over `src/sdk/main`, `src/sdk/tests`,
  `src/tck`); `build` Linux Debug-always/Release-on-merge with vcpkg + Hiero Solo CTest; optional
  `build-windows` (MSBuild) and `build-macos` (Ninja, arm64).
- **Permissions:** `contents: read`. **Destructive?** No. **Labels:** none.

### 15. Reusable Workflow Linter
- **Workflow:** `zxc-lint-workflows.yaml`
- **Trigger:** `pull_request` opened/reopened/synchronize on `.github/actionlint.yaml` or
  `.github/workflows/**`, + `workflow_dispatch`. Runs `actionlint` v1.7.12 with
  `.github/actionlint.yaml` (which registers the `hiero-client-sdk-linux-large` self-hosted runner label).
- **Permissions:** `contents: read`. **Destructive?** No. **Labels:** none.

### 16. Bot Script CI Tests
- **Workflow:** `zxc-test-bot-scripts.yaml`
- **Trigger:** `pull_request` opened/reopened/synchronize on `.github/scripts/**` or
  `.github/workflows/zxc-test-bot-scripts.yaml`, + `workflow_dispatch`.
  Node 20, `npm ci` + `eslint`, then runs the full bot unit-test suite (`tests/test-*.js`) covering
  checks, comments, api, recommend-issues, on-pr-open/update/review/merged/close, assign, inactivity,
  on-comment.
- **Permissions:** `contents: read`. **Destructive?** No. **Labels:** none.

---

## Appendix A — `hiero-automation.json` config keys

```
maintainerTeam
goodFirstIssueSupportTeam
labels.status.{awaitingTriage, readyForDev, inProgress, blocked, needsReview, needsRevision}
labels.skill.{goodFirstIssue, beginner, intermediate, advanced}
labels.priority.{critical, high, medium, low}
skillHierarchy[]            priorityHierarchy[]
skillPrerequisites["skill: <level>"].{requiredLabel, requiredCount, displayName}
    # + prerequisiteDisplayName on beginner/intermediate/advanced only (absent for "skill: good first issue")
assignmentLimits.maxOpenAssignments   (= 2)
assignmentLimits.maxGfiCompletions    (= 5)
documentation.{workflowGuide, readme, signingGuide, mergeConflictsGuide}
community.discordChannel
```

## Appendix B — Label strings referenced

**Status:** `status: awaiting triage`, `status: ready for dev`, `status: in progress`,
`status: blocked`, `status: needs review`, `status: needs revision`
**Skill:** `skill: good first issue`, `skill: beginner`, `skill: intermediate`, `skill: advanced`
**Priority:** `priority: critical`, `priority: high`, `priority: medium`, `priority: low`
**Prefix scans:** `status:` (bulk removal on merge / inactivity), `skill:` and `priority:`
(validation in `/finalize`).

All label literals originate from `hiero-automation.json` — there are **no hard-coded label strings**
in the C++ handlers, which is the property the wider decoupling effort wants to preserve and generalise.
