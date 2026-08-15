# Supported delivery trace

This is the shortest end-to-end reading path for the current runnable application:

1. `packages/shell/src/receiver.ts` verifies the HMAC over exact request bytes, validates headers,
   and durably accepts the delivery before returning `202`.
2. `packages/shell/src/shell.ts` connects the receiver, Store, and processor.
3. `packages/shell/src/processor.ts` claims the durable delivery, loads configuration, admits only
   the supported pull-request journey, reads the linked-issue observation, and atomically stores the
   canonical report while completing the delivery.
4. `packages/core/src/config.ts` parses the one strict configuration shape.
5. `packages/core/src/linked-issue.ts` validates repository/pull-request input and makes the pure
   linked-issue decision.

## Input

The endpoint accepts authenticated `pull_request` webhooks with action `opened`, `edited`, or
`reopened`. The payload repository owner/name must case-insensitively match `REPO_OWNER` and
`REPO_NAME`; malformed, inconsistent, closed, or mismatched pull requests are refused. Numeric
repository and installation binding waits for the Stage 5 GitHub adapter.

The configuration contract is `.github/hiero-automations.yml`:

```yaml
schemaVersion: 1
mode: dry-run

capabilities:
  linkedIssue:
    enabled: true
```

## Observation and decision

The future GitHub reader has one narrow result: `present`, `absent`, or `unknown`. The temporary
runnable reader always returns `unknown`. Unknown never becomes absence.

- `disabled` does not call the reader.
- `observe` records present/absent/unknown but proposes no advisory.
- `dry-run` records exactly one desired advisory only for `absent`.
- `active` is rejected before admission or reading because no effect path exists.

## Durable completion

The exact signed bytes are stored before acknowledgement. Processing uses Store claim ownership and
`completeDeliveryWithReport`, which inserts the one canonical JSON report and completes the delivery
in one SQLite transaction. A lost claim cannot persist or complete a report. Duplicate delivery GUIDs
with the same identity are acknowledged from their durable row; conflicting GUID reuse is rejected.

No GitHub read or write is implemented in this stage. Store effect and schedule contracts remain
unchanged for deliberate removal in Stage 4A.
