# Label Inventory: Hiero JavaScript SDK

> **Scope:** every label the automation under `.github/` of
> [`hiero-ledger/hiero-sdk-js`](https://github.com/hiero-ledger/hiero-sdk-js) reads or writes.
> **Source:** `main` at `a7c39d2` (2026-06-26). Builds on `audit/services-js.md`. **Descriptive.**

## Headline

The JavaScript SDK automates **zero labels**. Nothing adds, removes, or auto-creates a label, and nothing
gates on one. So there is no label state machine and no spelling drift, the cleanest contrast with C++ (14
automated labels from one config, zero drift) and Python (writes the `queue:*` family, four drift sets).

## The one touchpoint, read-only

`slack-issue-notify.yml` joins a new issue's label names into a string and prints them in its Slack message
(`join(github.event.issue.labels.*.name)`, line 49). That is display only: not a gate, not a write, no
hard-coded label string. Every other workflow ignores labels entirely.

## Everything else is empty

- **No state machines:** no `status:` lifecycle, review queue, skill ladder, or moderation flow. The PR
  Formatting gate writes a commit status, not a label.
- **No runtime creation:** nothing calls `createLabel` or passes labels to `issues.create`.
- **Manual labels still exist** in the repo (applied by hand and templates), but no automation reads or
  writes them, so they are out of scope here.

Every CI, release, dependency, link, notifier, and gate workflow was checked: the automated label count is
zero.
