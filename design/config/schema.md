# Linked-issue configuration contract

The repository path is `.github/hiero-automations.yml`. Stage 3 consumes an operator-maintained
local copy; Stage 5 will fetch the same path from GitHub.

```yaml
schemaVersion: 1
mode: dry-run

capabilities:
  linkedIssue:
    enabled: true
```

This is the entire schema. The parser rejects unknown keys and capabilities. `settings` may be
omitted or an empty mapping, and is validated even when `enabled` is false. The four modes are
`disabled`, `observe`, `dry-run`, and `active`; the runnable process rejects `active` because it has
no external effect path. An absent or empty local copy produces inert observe configuration.

There is no extension registry, label mapping, principal, permission, scheduling, risk, retry, or
capability-specific wording configuration in this stage.
