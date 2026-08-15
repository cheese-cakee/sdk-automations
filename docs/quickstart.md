# Quickstart

> The App is in development and not yet installable. It performs no GitHub writes.

Keep this operator-maintained configuration at `.github/hiero-automations.yml`:

```yaml
schemaVersion: 1
mode: dry-run

capabilities:
  linkedIssue:
    enabled: true
```

The runnable process receives `pull_request` deliveries for `opened`, `edited`, and `reopened`.
It records whether GitHub reports a same-repository closing issue reference. Until the real GitHub
reader lands, the runnable process records that observation as unknown and proposes no advisory.

See the [configuration reference](configuration.md) and [troubleshooting](troubleshooting.md).
