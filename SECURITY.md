# Security

This repository is the design and in-progress implementation of a hosted,
configuration-driven GitHub App. It is pre-ratification: the packages are
candidates pending stage-four review, and no hosted service or production
installation exists yet. This document states the current posture honestly
rather than aspirationally.

## Key posture

- No production credentials live in tracked code. `lab/` keeps credentials and
  raw evidence in local-only, untracked paths, and `.env` is never tracked.
- `core/` is pure logic: no I/O and no clock reads; the shell supplies
  observations. The owned operational store lives in `store/`, and `probes/`
  are deliberately disposable capability stubs.
- GitHub remains authoritative for visible repository facts. Configuration is
  fail-closed: an invalid file yields no configuration and drops the
  repository to `observe`, where the platform reads and reports but performs
  no workflow-changing writes.
- Webhook signature verification is implemented and tested in
  [`packages/core/src/github/signatures.ts`](packages/core/src/github/signatures.ts).
- The recovery design treats effect claims as leases and relies on journaling
  plus GitHub re-reads rather than assuming a single in-flight worker. The
  overlap contract and retention windows are still open decisions in
  [`design/decisions.md`](design/decisions.md).

## Supply chain

- GitHub Actions are pinned to full commit SHAs with version comments, and
  permissions are the smallest set each workflow needs.
- CI runs on `pull_request`, deliberately not `pull_request_target`, so fork
  code executes with a read-only token and no secrets.
- `pnpm install --frozen-lockfile` keeps dependency resolution reproducible;
  `pnpm audit --audit-level moderate` runs on every push and pull request.
- The test pipeline runs typecheck and tests on Node 24 and 25, plus mutation
  thresholds for `core/` that fail the build when coverage regresses.
- Contributions are signed off with `git commit -s`; maintainers enforce the
  DCO.

## Reporting

Please use GitHub's private vulnerability reporting on this repository rather
than a public issue. Security-sensitive design discussion belongs in
[`design/operations/threat-model.md`](design/operations/threat-model.md), where
open threats and required controls are tracked explicitly.
