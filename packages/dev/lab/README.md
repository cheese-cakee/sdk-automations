# The lab

The standing instrument for one job: **facts about GitHub's behaviour that only contact with
GitHub can verify.** Tests verify our code; the lab verifies our beliefs about someone else's
system. Conclusions never live here — they migrate to `design/` as decision rows (D32), and the
protocols stay here with the instrument that executes them.

Three eras (D87, D88):

1. **Feasibility (July 2026, closed)** — protocols 6.1–6.7 below, run by the throwaway `harness/`.
   Frozen as methods; their conclusions are in the register.
2. **Capture (current)** — protocol 7.1: scrubbed webhook payloads for the `events.ts` normalizer.
   `src/scrub.ts` is the rules, `src/capture.ts` the receiver, and nothing unscrubbed can reach a
   tracked path by construction.
3. **Conformance (when the adapter ships)** — scheduled probes re-verify the perishable facts in
   `packages/core/src/github/` and stamp a tracked result file a `checks/` lock reads.

Tracked: `protocols/`, `src/`, `test/`. Never tracked: `harness/` (the era-1 code and private
evidence archive), `evidence/` (capture staging), `.env` — enforced by `packages/dev/checks/test/never-tracked.test.ts`,
not just `.gitignore`. The lab tracks no evidence: reviewed captures go straight into the testkit as
fixtures, conclusions go to the register, and everything else stays local.

## The road ahead

```mermaid
flowchart LR
    subgraph lab ["lab/"]
        capture["src/capture.ts — scrub, then write"] --> pending["evidence/pending/ (untracked)"]
        probes["era-3 probes (adapter era)"] --> results["probe-results.json"]
    end
    pending -->|"a human reads every file"| fixtures["packages/dev/testkit/fixtures/ — for events.ts"]
    results -.->|"lock reads"| checks["checks/: probedAt matches latest run"]
    conclusions["every era's conclusions"] --> register["design/decisions.md"]
```

Next, in order, each on its trigger:

- [ ] **7.1 first capture run** — when `events.ts` work starts. One payload per observation kind;
      the catalogue is the shopping list.
- [ ] **Reviewed captures land directly in `packages/dev/testkit/fixtures/`** — no waypoint: the
      capture trigger IS the normalizer trigger, and fixtures reach the packages that need them
      through the testkit's export, so they travel into every mutation sandbox that consumes them.
- [ ] **Era-3 conformance probes + schedule** — when the adapter ships. Re-verify `BODY_PATTERNS`
      and rate-limit semantics; stamp `probe-results.json`; add the `checks/` lock that reads it.

---

## Era 1 — the feasibility experiments (frozen record)

The falsification experiments from `design/build-plan.md` §6: a throwaway
development GitHub App run against a **personal sandbox repository**,
producing the evidence the stage-three exit gate required. The design's
assumptions met real GitHub API behavior here for the first time.

## Capture run

Copy `.env.example` to `.env` and fill in the values:

```bash
cp lab/.env.example lab/.env
```

Then run the capture receiver:

```bash
pnpm --filter @hiero-hackers/lab capture
```

## Ground rules

- **Personal sandbox only** (P8, D22 — both `supported`). The App installs
  on a personal scratch repository, never on a Hiero or Hiero Hackers
  repository. The org sandbox is ring one and comes later, with its owner
  and entry criteria recorded first.
- **The harness is disposable; the evidence is the product.** Nothing in
  `harness/` is the future platform. Every API interaction is captured as
  structured JSON so observations carry their own citations, in the same
  spirit as the `audit/` file:line style.
- **Bounded hostility.** Experiments that provoke failures (secondary rate
  limits, forged webhooks) are capped in the harness; we measure GitHub's
  behavior, we do not hammer GitHub's infrastructure.
- **Fork code is never executed with App write credentials** (§6.6).

## The experiments

| Protocol | Build plan | Register rows it feeds |
|---|---|---|
| [`protocols/6.1-installation-auth.md`](protocols/6.1-installation-auth.md) | §6.1 | permission matrix, diagnostics |
| [`protocols/6.2-webhook-delivery.md`](protocols/6.2-webhook-delivery.md) | §6.2 | P9, D1, D18, Q15 |
| [`protocols/6.3-configuration.md`](protocols/6.3-configuration.md) | §6.3 | D31, Q14 |
| [`protocols/6.4-adapter.md`](protocols/6.4-adapter.md) | §6.4 | D9, D20, Q10, Q16 |
| [`protocols/6.5-recovery-storage.md`](protocols/6.5-recovery-storage.md) | §6.5 | D1, D13, D24, D27, Q15 |
| [`protocols/6.6-forks.md`](protocols/6.6-forks.md) | §6.6 | permission matrix, Q11 |

Run order: 6.1 and 6.2 first (the substrate), then 6.3 (reuses the
`core/` validator), 6.4, then 6.5 with the largest time budget — it
produces a *decision*, not just measurements — and 6.6 last.

## Exit-gate artifacts

The stage-three gate closes when these are filled with observations and
the affected register rows are updated:

- [`endpoint-permission-matrix.md`](../../../design/operations/endpoint-permission-matrix.md) — one
  row per operation: endpoint, permission, observed behavior.
- [`storage-decision.md`](../../../design/operations/storage-decision.md) — the three recovery
  sources compared against the five operational needs.
- Each protocol's own **Observations** section, with delivery ids and
  response excerpts as citations.

Closing the gate is a pull request that flips D1, D9, D13, D18, D24, and
D27 to evidence-backed statuses and answers Q10, Q15, and Q16.

## Evidence provenance

The raw evidence logs (`harness/evidence/*.jsonl`) are held privately —
they embed complete webhook payloads, including commit-author email
addresses — and are available to gate reviewers on request. Citation
ids in the protocol documents (`…T19-45-…#14`) resolve into that
private archive; a dangling citation in a published document is
expected, not an error. The protocol documents themselves contain no
secrets, credentials, tunnel URLs, or personal identifiers and are
safe to publish.
