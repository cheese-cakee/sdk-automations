# The sweep — schedules become facts

> **The second producer of facts, and the only one that reads everything.** The sweep produces the
> fact shapes in `design/contracts/facts.md`: on a schedule it reads every open item of a repository,
> builds one record per item with every group read, and hands the engine one decision per record.
> The webhook producer reads the projection only; the sweep reads everything, which is why the
> clock-driven capabilities need it.

## 1. What the sweep reads, and what is confirmed

| Fact | Read | Permission | Status in the matrix |
|---|---|---|---|
| open items, labels, state, assignees, `updated_at` | `GET /repos/{o}/{r}/issues` paged, `state=open` (pull requests included, flagged by `pull_request`) | Issues R | confirmed, ETag, link pagination |
| `assignedAt` per assignee | the item timeline's `assigned` events, newest per login | Issues R | confirmed (timeline) |
| `lastWorkingAt` per assignee | the item's comments whose body's first token folds to the repository's `working` command spelling, by author, newest | Issues R | confirmed (list comments) |
| a pull request's `draft` — the whole `readiness` group | `GET /repos/{o}/{r}/pulls/{n}` | Pull requests R | confirmed |
| `changesRequested` | `GET /pulls/{n}/reviews` folded to the latest DECIDING state per reviewer — the reader implements this, not GraphQL `reviewDecision` | Pull requests R | confirmed 2026-09-12 (6.9), ETag, 1 page |
| `reapableSince` | the timeline's `convert_to_draft` / `ready_for_review` / `review_requested` events and the newest `changes requested` review, whichever entered the current mode | Pull requests R, or Issues R — either alone answers the timeline on a pull-request number | confirmed 2026-09-12 (6.9), ETag |
| `lastCommitAt` | `GET /repos/{o}/{r}/pulls/{n}/commits`, last page | Pull requests R | confirmed 2026-09-12 (6.9), ETag, 1 page |
| a pull request's linked issues with their assignees | GraphQL `closingIssuesReferences` (confirmed) joined to the issues already listed | Issues R + Pull requests R | confirmed for same-repository links |
| an issue's open linked pull requests | the inverse of the row above, built from the sweep's own pull-request records — no separate read | — | derived |

The App's own standing reminder is not a read any more: the platform holds its warning record
(`design/guides/grace.md` §4). `draft` left the `review` group for a `readiness` group of its own
once the study found that a webhook can read it whole. **Every read above is now confirmed**, so the
sweep answers every group its registry row promises, `review` included. The rule that put the three
there has not changed: a read absent from the matrix is never sent, and the driver answers its group
`unread` rather than guessing.

## 2. What the driver does

1. A schedule row `sweep:{owner}/{repo}` is due. The shell claims it (the store's claim-token
   pattern), reads the repository's configuration through the config source, and if the
   repository enables no capability that declares `trigger: schedule`, completes the row and
   schedules the next.
2. It lists open items once (conditional reads; a 304 costs nothing), then for each item reads the
   groups above through one adapter seam, `FactsReader` — a factory over the client and the
   repository, returning `IssueFacts` / `PullRequestFacts` with `trigger: { kind: "sweep" }`, and
   marking any read that failed or is unconfirmed as `unread` for that group rather than guessing.
3. It hands the engine one record at a time — `decide({ kind: "facts", facts })` — under the
   delivery lifecycle the processor already has (a sweep record is a synthetic delivery with its
   own id `sweep:{schedule}:{item}`), so reports, effects, the applier and recovery are unchanged.
4. It schedules the next sweep at the configured cadence (default hourly, because a clock the sweep
   cannot see is a promise the App cannot keep: `MIN_REAP_HOURS` is two hours, and a daily sweep
   would let a two-hour clock run a day before anyone was warned about it) and completes the row.

## 3. Cost

Per sweep, per open item: one timeline page, one comments page, and for a pull request one PR read,
one commits page, one reviews read, one GraphQL link query — about six points an item on a cold
cache, most of them conditional thereafter. At the fleet design point (fifty repositories, twenty
open items each) that is a thousand items an hour at the default cadence. The per-item reads are
conditional — every GET carries the ETag the adapter cached, and a 304 costs nothing — so the
steady-state price of a quiet hour is the one read that cannot be conditional: the GraphQL
linked-issues query, one point per open pull request. The ETag cache is in-process and bounded
(a thousand entries, twenty megabytes), so a repository past a few hundred open items evicts
between firings and those reads cost a point each again. The secondary limit is about write
concurrency and the sweep writes nothing itself.

## 4. What is still open

- Nothing on the read side. Protocol 6.9 cited `changesRequested`, `reapableSince` and
  `lastCommitAt` on 2026-09-12, so the `review` group is read and the pull-request ladder decides
  rather than being skipped by the `factsUnread` finding. The finding itself stays: it covers a read
  that FAILED, and any read a later group is built from that the matrix has not confirmed.
- The `pull_request_review` subscription question the matrix already records: the sweep does not
  need it, because it reads reviews rather than waiting to be told.
