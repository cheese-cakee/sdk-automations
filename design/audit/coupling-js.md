# Service Dependency and Coupling Map: Hiero JavaScript SDK

> **Scope:** how the automation services in
> [`hiero-ledger/hiero-sdk-js`](https://github.com/hiero-ledger/hiero-sdk-js) depend on each other, in the
> terms of `audit/coupling-cpp.md`.
> **Source:** `main` at `a7c39d2` (2026-06-26). Builds on `audit/services-js.md` and `audit/labels-js.md`.
> Serves goals.md Goal 1 ("decoupled by function"). **Descriptive.**

## Headline

There is effectively **no coupling** between services here, because there is almost no automation to couple.
C++ binds its services through six shared-state channels; the JavaScript SDK shares none of them.

## The six C++ channels, checked here

| # | Channel (from `audit/coupling-cpp.md`) | In JS? | Detail |
|---|---|:--:|---|
| 1 | Status labels as shared state | No | no service writes a label |
| 2 | Bot comments updated in place | No | nothing posts back to an issue or PR |
| 3 | Assignees as shared state | No | `pr_check.yml` reads if an assignee exists, but writes none |
| 4 | A central config file | No | no `hiero-automation.json`; only the Slack channel id, copied per notifier |
| 5 | Cross-entity links (PR to issue, milestones) | No | nothing resolves a linked issue or milestone |
| 6 | Shared workflow files or modules | Minimal | notifiers are independent files; they only repeat the same channel id and bot filter by copy |

## What it means

By accident of having little automation, the JavaScript SDK is already at the end state Goal 1 describes:
every workflow is an independent unit, switchable on or off with no side effects. But it gets the decoupling
for free only because it has none of the capability. So it is a useful boundary case, what zero coupling
looks like, not a model to copy: it says nothing about how to keep the C++ capabilities and still decouple
them.

## One duplication to note

The six notifiers each hard-code the same Slack channel id (`C0958RN2ZTR`) and the same four-name bot
filter. That is copy-paste duplication (like Python's repeated excluded-author lists), not a runtime
dependency. If notification logic ever grew, those are the obvious candidates for one shared value, the
small-scale version of the config-driven principle in `planning/goals.md`.
