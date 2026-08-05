# What we observed about GitHub

Everything else in `core/` encodes a decision the project made. Those change
only when someone decides differently, and until then they stay true.

**This directory is different. Its contents can become wrong while nobody
touches them,** because they describe a live system that is free to change
underneath us. Green tests here do not mean correct — they mean the code
still agrees with what we measured on the date below.

## What belongs here

One question decides it:

> Could GitHub change, and make this file wrong, with nobody having edited it?

**Yes** → it belongs here. **It encodes a rule we chose** → it belongs
elsewhere, however much it mentions GitHub.

The line is easy to blur, so two worked examples:

- `capability/catalogue.ts` names operations like `postManagedComment`. That
  reads like GitHub, but it is *our* closed vocabulary (D61) — the endpoint it
  becomes is the adapter's business, outside `core/` entirely. **Not here.**
- `workflow/meanings.ts` has `awaitingTriage`. Also not GitHub: P7 and D71
  make these platform meanings that repositories map onto their own labels.
  **Not here.**
- `github/ids.ts` exists because REST delivery ids exceed 2^53
  (`FINDING(delivery-id-precision)`). If GitHub changed its id format, this
  file would be wrong tomorrow with no commit in between. **Here.**

That last one was genuinely arguable — the branding *mechanism* is a shared
primitive, and only the *reason it exists* is an observed fact. It is recorded
here so the question is settled once rather than re-litigated per file.

## Provenance, and how each file goes stale

D40 makes re-probing a standing obligation. This table is where that
obligation lives next to the code it governs, rather than only in the register.

| File | Probed by | Date | Goes stale when | First symptom |
|---|---|---|---|---|
| `failures.ts` | experiment 6.4 | 2026-07-23 | GitHub rewords error bodies | a rise in `forbiddenUnrecognized` classifications |
| `rate-limits.ts` | experiment 6.4 | 2026-07-23 | header semantics or the secondary-limit floor change | waits that are far too short, or absent |
| `ids.ts` | experiment 6.2 | 2026-07-23 | delivery id format changes | duplicate deliveries surviving dedup |

**Cadence:** quarterly, plus ad-hoc whenever the first-symptom column starts
showing up in operator reports. **Owner:** unassigned — falls out of Q13, and
is one of the unfilled rows in `design/build-plan.md` §14.

## Why the failure mode is quiet

`failures.ts` classifies GitHub responses by matching prose in the body. When
GitHub rewords a message, the regex stops matching and the response degrades to
`forbiddenUnrecognized` — deliberately, so a reworded error surfaces as
"unknown" rather than being confidently misdiagnosed as something it is not.

That is the right behaviour and it is also why nothing breaks loudly. The
tests keep passing, because they assert against recorded fixtures rather than
against GitHub. **The fixtures and the world drift apart in silence, and only
the re-probe closes the gap.**

## Not yet here, but expected

As the platform reaches GitHub, more observed knowledge will want this home —
at which point subdirectories may start to earn their keep:

- `endpoints.ts` — the confirmed operation list from
  `design/operations/endpoint-permission-matrix.md`.
- `permissions.ts` — the ratified permission ceiling, currently a loose
  template type in `capability/declaration.ts`.
- `events.ts` — the webhook subscription list, including the
  `pull_request_review` gap experiment 6.6 found.
- the read-after-write freshness rule (D46, experiment 6.7), which today sits
  in `executor/src/policy.ts` mixed in with adopted *decisions* like the lease
  duration. Those two kinds of constant have different owners and different
  reasons to change; splitting them is a follow-up, not part of this move.
