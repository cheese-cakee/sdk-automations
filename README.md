<p align="center">
  <img src="design/readme-wordmark.png" alt="SDK AUTOMATIONS" width="100%">
</p>

[![CI](https://github.com/hiero-hackers/sdk-automations/actions/workflows/ci.yml/badge.svg)](https://github.com/hiero-hackers/sdk-automations/actions/workflows/ci.yml) [![CodeQL](https://github.com/hiero-hackers/sdk-automations/actions/workflows/codeql.yml/badge.svg)](https://github.com/hiero-hackers/sdk-automations/actions/workflows/codeql.yml) [![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE) [![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/hiero-hackers/sdk-automations/badge)](https://scorecard.dev/viewer/?uri=github.com/hiero-hackers/sdk-automations)

Repository-owned configuration. Durable, explainable decisions. No server to host.

Hiero SDK repositories repeat the same contributor-facing work: intake, triage, workflow labels,
pull-request checks, status reporting. This engine does it from a reviewed `sdk-automations.yml`
on a repository's default branch, decides one issue or pull request at a time, and writes down what
it decided and why. It runs as a GitHub Action inside the repository's own workflow
([`docs/installing.md`](docs/installing.md)); the hosted App shape remains for an organisation that
wants central operation. It is pre-1.0 and in a pilot.

## Who it is for

- **The maintainer** who writes `sdk-automations.yml` — [`docs/`](docs/README.md).
- **The operator** who runs the hosted shell — [`docs/running.md`](docs/running.md).
- **The contributor** who changes the platform — [`CONTRIBUTING.md`](CONTRIBUTING.md).

## What one delivery does

1. **Receive** — a workflow run starts with the event; the hosted shell instead verifies the HMAC
   and stores the delivery before its 202.
2. **Read** — the engine reads `sdk-automations.yml` at the default branch, never at a pull request's head.
3. **Decide** — each enabled capability judges one item and asks for outcomes; the safety ladder
   gates every one of them, and a refusal carries a code an operator can look up.
4. **Apply** — an approved effect is journalled before it is sent, re-checked against a live read,
   sent, and confirmed by reading GitHub back. Writes need the mode `active` and the Action's
   `arm-writes` switch; otherwise the pass records what it would do.
5. **Record** — the run's job summary lists each decision and effect; the hosted shell keeps them in
   its store for `pnpm shell:explain`.

## Read next

- [`docs/installing.md`](docs/installing.md) — add the Action: two files and the switch that arms writes.
- [`docs/`](docs/README.md) — use it: the quickstart, every key, every code, and how to run it.
- [`design/trace.md`](design/trace.md) — one label from the webhook to the API call, then
  [`design/architecture.md`](design/architecture.md) for what each piece is and which rule holds it.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — change it, and pick up a
  [good first issue](https://github.com/hiero-hackers/sdk-automations/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22).
- [`SECURITY.md`](SECURITY.md) — report a vulnerability privately.

## Run the tests

[Node.js](https://nodejs.org/) 24 or newer and [pnpm](https://pnpm.io/) 10.29.1.

```bash
pnpm install
pnpm -r test
```

Every tracked test runs offline: no GitHub credentials, no network, no App configuration.

---

Apache-2.0 licensed · [Code of Conduct](CODE_OF_CONDUCT.md) · Developer Certificate of Origin
required for contributions
