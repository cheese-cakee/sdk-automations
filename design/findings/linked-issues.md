# Linked-issue semantics

**Answer (D123, protocol 6.8): use same-repository closing references only.** A plain mention is
not a closing reference. Under App auth, a hidden cross-repository target and a missing Issues grant
both produce a clean empty connection, indistinguishable from a genuinely unlinked pull request.
The resolver therefore checks both required grants before reading and does not support
cross-repository links in its first scope.

## Measured

| Case | Probe | Result |
|---|---|---|
| Keyword close | #169, body `Closes #167` | `totalCount: 1`, `[167]` |
| **Mention only** | #170, body `related to #167`, `see #168` | **`totalCount: 0`, `[]`** |
| Two closes | #171, `Closes #167 and Closes #168` | `totalCount: 2`, `[167, 168]` — body order preserved |
| Edited after open | #172, opened unlinked, then edited | unlinked, then `[168]` within **3 s** of the edit |
| Unlinked | six pre-existing sandbox PRs | `totalCount: 0`, `nodes: []` — no error |
| Cost | any of the above | **1 point** of 5,000/hour |

The original semantic cases were measured 2026-08-17 on
`exploreriii/automation-sandbox`, probes #167–#172.

## App-auth measurement

Measured twice on 2026-08-30 with a private source repository, an installed
private target, and a private target outside the installation.

| Case | Result |
|---|---|
| Same-repository close, full or source-only token | one linked issue |
| Cross-repository close, installed and visible target | one linked issue |
| Unlinked control | clean empty connection |
| Issues grant omitted | clean empty connection |
| Cross-repository target omitted from token or installation | clean empty connection |
| Pull requests grant omitted | partial data plus `FORBIDDEN` |
| Source repository outside installation | `repository: null` plus `NOT_FOUND` |
| Invalid bearer value | HTTP 401, `Bad credentials` |

Each valid query cost one point. Exact response shapes and repeat citations are
in protocol 6.8's observation table.

## What this decides

- **`linkedIssues` means non-user-linked closing references.** A contributor writing "related to
  #167" produces no link. The audit's B2 finding was that the existing bots answer this question two
  ways that can disagree — a body-text regex in one path, closing references in another. The
  platform requests `excludeUserLinked: true`; any repository wanting mention-based or manual links
  needs an explicit catalogue decision, never a silent difference. See GitHub's
  [`PullRequest`](https://docs.github.com/en/graphql/reference/pulls#pullrequest) schema.
- **The resolver may not be memoized across a delivery.** References update within ~3 s of a body
  edit, so a cached answer can be wrong while the item is still being decided.
- **The first resolver is same-repository only.** Cross-repository links work when both repositories
  are visible, but disappear silently when the target is not. The current resolver item also carries
  no target-repository identity with which to prove visibility.
- **Check grants before querying.** Missing Pull requests permission is explicit, but missing Issues
  permission looks exactly like an unlinked pull request. The resolver needs both `issues: read` and
  `pull_requests: read`; otherwise it returns `unknown`, never an empty list.
- **Within that scope, absence is confident only after the precheck.** A visible PR, both grants,
  an empty connection, and no GraphQL errors means unlinked. Any error or malformed shape is
  `unknown`.
- **The cost fits the modeled sweep.** At one point per query, Q10's 1,000-item example costs about
  1,000 of the installation's 5,000 hourly points before conditional-read savings.

## Limits of this measurement

- The documented manual-link filter was not re-probed against these App-auth fixtures.
- Two runs used personal private repositories under ordinary load; they establish response shapes,
  not production latency or availability.
