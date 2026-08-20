# Linked-issue semantics

**Answer (D115, protocol 6.8): `closingIssuesReferences` means closing keywords only — a mention is
not a link.** Measured 2026-08-17 on `exploreriii/automation-sandbox`, probes #167–#172.

## Measured

| Case | Probe | Result |
|---|---|---|
| Keyword close | #169, body `Closes #167` | `totalCount: 1`, `[167]` |
| **Mention only** | #170, body `related to #167`, `see #168` | **`totalCount: 0`, `[]`** |
| Two closes | #171, `Closes #167 and Closes #168` | `totalCount: 2`, `[167, 168]` — body order preserved |
| Edited after open | #172, opened unlinked, then edited | unlinked, then `[168]` within **3 s** of the edit |
| Unlinked | six pre-existing sandbox PRs | `totalCount: 0`, `nodes: []` — no error |
| Cost | any of the above | **1 point** of 5,000/hour |

## What this decides

- **`linkedIssues` means closing references.** A contributor writing "related to #167" produces no
  link. The audit's B2 finding was that the existing bots answer this question two ways that can
  disagree — a body-text regex in one path, closing references in another. The platform takes closing
  references, and any repository wanting mention-based links needs configuration, never a silent
  difference.
- **The resolver may not be memoized across a delivery.** References update within ~3 s of a body
  edit, so a cached answer can be wrong while the item is still being decided.
- **`absent` and `unknown` are distinguishable at the transport.** An unlinked PR returns
  `totalCount: 0` with no error; a missing PR returns `data.repository.pullRequest: null` **plus** an
  `errors[]` entry of type `NOT_FOUND`. So the adapter maps a null-with-error to `unknown` and an
  empty list to a confident `absent` — the fail-honest read holds.
- **Cost is not a constraint.** 1 point per query leaves the Q10 budget untouched even under sweep.

## Limits of this measurement

- Run under a **user token**, not an installation token. Permissions and visibility can differ, so
  the App must confirm before the resolver ships.
- **Cross-repository references were not tested** — needs a second sandbox repository, and the
  question of whether the installation needs an extra grant is still open.
- **Failure shapes under App auth were not tested** — expired token, repository outside the
  installation. Protocol 6.8 cases 3 and 7 remain open.
- One repository, one day, ordinary load.
