# Configuration reference

The repository contract is `.github/hiero-automations.yml`. Stage 3 still reads an
operator-maintained local copy of that file.

```yaml
schemaVersion: 1
mode: dry-run

capabilities:
  linkedIssue:
    enabled: true
```

The parser is fail-closed. `schemaVersion` must be `1`; `mode` must be `disabled`, `observe`,
`dry-run`, or `active`; `linkedIssue.enabled` must be a boolean. `linkedIssue.settings` may be
omitted or an empty mapping. Unknown keys, unknown capabilities, and non-empty settings are errors,
including under a disabled capability.

- `disabled` does not evaluate the capability.
- `observe` reports the linked-issue observation without proposing an advisory.
- `dry-run` proposes the centralized advisory only when the observation is `absent`.
- `active` is rejected because external effects are not implemented.

An empty or absent local copy is inert: observe mode with `linkedIssue` disabled.
