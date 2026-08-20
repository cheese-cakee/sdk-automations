# Security

This repository is the design and in-progress implementation of a hosted,
configuration-driven GitHub App. It is pre-ratification: the packages are
candidates pending stage-four review, and no hosted service or production
installation exists yet. This document states the current posture honestly
rather than aspirationally.

## Key posture

- No production credentials live in tracked code. `packages/dev/lab/` keeps credentials and
  raw evidence in local-only, untracked paths, and `.env` is never tracked.
- `packages/core/` is pure logic: no I/O and no clock reads; the shell supplies
  observations. The owned operational store lives in `packages/store/`, and `packages/probes/`
  are deliberately disposable capability stubs.
- GitHub remains authoritative for visible repository facts. Configuration is fail-closed: the shell
  persists one `configRejected` record, completes that delivery, and never calls the decision engine with a
  partial or fallback configuration.
- Webhook signature verification is implemented and tested in
  [`packages/core/src/github/signatures.ts`](packages/core/src/github/signatures.ts).
- The store schema contains effect claims and a journal for future recovery. No effect executor is wired
  today; the overlap contract and retention windows are still open decisions in
  [`design/decisions.md`](design/decisions.md).

## Supply chain

- GitHub Actions are pinned to full commit SHAs with version comments, and
  permissions are the smallest set each workflow needs.
- CI runs on `pull_request`, deliberately not `pull_request_target`, so fork
  code executes with a read-only token and no secrets.
- `pnpm install --frozen-lockfile` keeps dependency resolution reproducible;
  `pnpm audit --audit-level moderate` runs on every push and pull request.
- The test pipeline runs typecheck and tests on Node 24 and 25, plus line and mutation gates for the
  packages that declare them (`core`, `probes`, `shell`, and `store` currently).
- Contributions are signed off with `git commit -s`; maintainers enforce the
  DCO.

## Supported versions

| Version | Supported |
|---|---|
| `main` | Yes — the only supported branch |
| Tagged releases | None exist yet; there is no published package or hosted service |

No hosted service or production installation exists, so a vulnerability here
affects contributors and anyone running the code locally, not end users.

## Reporting a vulnerability

**Report privately at
<https://github.com/hiero-hackers/sdk-automations/security/advisories/new>** —
GitHub's private vulnerability reporting. Please do not open a public issue for
a suspected vulnerability.

If that page is unavailable to you, report it through the LFDT (Hyperledger) in the Hiero section
Discord at <https://discord.com/invite/hyperledger> and ask to reach a
maintainer of `hiero-hackers/sdk-automations` privately. Do not include the
details of the report in a public channel.

**What to expect.** Expect an acknowledgement within **7 days**, an initial assessment within **14 days**,
and a fix or a documented decision not to fix before any public disclosure. 

Security-sensitive design discussion that is *not* a vulnerability report
belongs in [`design/guides/threat-model.md`](design/guides/threat-model.md), where
open threats and required controls are tracked explicitly.
