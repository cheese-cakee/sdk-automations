# Service Inventory: Hiero JavaScript SDK

> **Scope:** the GitHub automation under `.github/` of
> [`hiero-ledger/hiero-sdk-js`](https://github.com/hiero-ledger/hiero-sdk-js), the most used Hiero SDK. The
> third codebase in the audit, after C++ and Python.
> **Source:** `main` at `a7c39d2` (2026-06-26). **Descriptive, not prescriptive.**

## Headline

The JavaScript SDK has **no maintainer issue or PR lifecycle automation**. Where C++ runs a bot framework
off one config file and Python runs ~40 small lifecycle bots, this SDK has neither: no central config, no
`status:` labels, no `/assign` or `/finalize`, no assignment limits, no skill ladder, no inactivity sweep.
Its 14 workflows are six read-only Slack notifiers, one PR-formatting gate, five build/test/release CI jobs,
one scheduled link check, and one scheduled dependency update. Logic is inline YAML.

## Summary

| Service | File | Group | Trigger | Destructive? |
|---|---|---|---|---|
| Slack Issue Notification | `slack-issue-notify.yml` | Notification | `issues` opened | No |
| Slack PR Notification | `slack-pr-notify.yml` | Notification | `pull_request` opened | No |
| Slack Issue Comment Notification | `slack-issue-comment-notify.yml` | Notification | `issue_comment` (issue only) | No |
| Slack PR Comment Notification | `slack-pr-comment-notify.yml` | Notification | `issue_comment` (PR only) | No |
| Slack Merge Notification | `slack-merge-notify.yml` | Notification | `pull_request` closed (merged) | No |
| Slack Release Notification | `slack-release-notify.yml` | Notification | `release` published | No |
| PR Formatting | `pr_check.yml` | PR Quality | `pull_request_target` opened/reopened/edited/synchronize/assigned | No |
| Broken Links Check | `broken-links.yaml` | Maintenance | `schedule` every 2 days | No |
| Renovate | `renovate.yml` | Dependencies | `schedule` weekly, dispatch | No |
| Build & Test | `build.yml` | Build/CI | `push`, `pull_request` | No |
| Common JS | `common_js.yml` | Build/CI | `push`, `pull_request` | No |
| React Native | `react_native.yml` | Build/CI | `push`, `pull_request` | No |
| Publish GH Pages | `pages.yml` | Build/CI | `push` | No |
| Publish Release | `publish_release.yaml` | Release | `workflow_dispatch`, `push` tags | No |

**Zero destructive services** (C++ has two, Python seven). Nothing unassigns, closes, locks, or strips
labels, because nothing manages lifecycle.

## The two in-scope services

**Notifications (six workflows).** Each reacts to one GitHub event and posts one message to a single Slack
channel (`C0958RN2ZTR`, set per file), filtering out bot authors (`dependabot`, `codacy-production`,
`lfdt-bot`, `codecov`). They split issue vs PR comments by the `issue.pull_request` flag, and merge fires
only on `merged == true`. All carry `*: read` only and write nothing back to GitHub.
`slack-issue-notify.yml` reads the issue's labels just to print them in the message (line 49); that is the
only label use anywhere.

**PR Formatting (`pr_check.yml`).** Two checks on a PR: a conventional-commit title, and that an assignee is
set. It writes only a commit status (`statuses: write`, line 16), no label, assignee, or comment. This is
the only write to PR state in the repo, and the only rough parallel to C++'s PR checks, minus the
auto-assign, DCO/GPG/conflict/issue-link checks, dashboard, and status label.

## The rest (project non-goal, for completeness)

- **CI/test:** `build.yml` (build plus Hiero Solo integration tests), `common_js.yml` (Node 22/24),
  `react_native.yml`.
- **Docs/release:** `pages.yml` (Pages), `publish_release.yaml` (broadest scope: `contents: write`,
  `id-token: write`).
- **Maintenance:** `broken-links.yaml` runs `scripts/broken-links-check.js`; unlike Python's it opens no
  tracking issue.
- **Dependencies:** `renovate.yml` points at `.github/renovate.json`, but no such file exists at this commit
  (checked five standard paths); real updates run through `dependabot.yml` (`github-actions` daily, `npm`
  monthly).

## Permissions posture

Everything reading issues or PRs reads only. The single PR-state write is `pr_check.yml`'s
`statuses: write`. The only broader scopes are Pages (`pages: write`, `id-token: write`) and Release
(`contents: write`, `id-token: write`), both for publishing. `build.yml` declares `pull-requests: write` but
uses it for coverage upload, not issue or PR management. The result matches the least-privilege principle in
`planning/goals.md`, but reached by having almost no automation rather than by design.

## Appendix: other `.github` config

- `dependabot.yml`: `github-actions` daily, `npm` monthly.
- `CODEOWNERS`: `*` to the JS maintainers and committers; `.github/` and `.github/workflows/` to
  `@hiero-ledger/github-maintainers`.
- `codecov.yaml`: coverage config used by CI.
