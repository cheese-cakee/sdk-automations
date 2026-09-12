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
| `changesRequested` | the pull request's review decision — GraphQL `reviewDecision`, or `GET /pulls/{n}/reviews` folded to the latest state per reviewer | Pull requests R | **needs a protocol** |
| `reapableSince` | the timeline's `convert_to_draft` / `ready_for_review` / `review_requested` events and the newest `changes requested` review, whichever entered the current mode | Issues R + Pull requests R | **needs a protocol** (timeline on a pull request number) |
| `lastCommitAt` | `GET /repos/{o}/{r}/pulls/{n}/commits`, last page | Pull requests R | **needs a protocol** |
| a pull request's linked issues with their assignees | GraphQL `closingIssuesReferences` (confirmed) joined to the issues already listed | Issues R + Pull requests R | confirmed for same-repository links |
| an issue's open linked pull requests | the inverse of the row above, built from the sweep's own pull-request records — no separate read | — | derived |

The App's own standing reminder is not a read any more: the platform holds its warning record
(`design/guides/grace.md` §4). `draft` left the `review` group for a `readiness` group of its own
once the study found that a webhook can read it whole: the sweep answers `readiness` for real, and
`review` is the one group it promises and cannot yet read. Each of the three unconfirmed reads
needs one sandbox protocol run to enter the endpoint-permission matrix with a citation, and the
driver treats it as `unread` until it does.

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
4. It schedules the next sweep at the configured cadence (default daily; `MIN_GRACE_DAYS` bounds
   what a shorter cadence could be worth) and completes the row.

## 3. Cost

Per sweep, per open item: one timeline page, one comments page, and for a pull request one PR read,
one commits page, one reviews read, one GraphQL link query — about six points an item on a cold
cache, most of them conditional thereafter. At the fleet design point (fifty repositories, twenty
open items each) that is a thousand items a day, well inside the primary budget; the secondary
limit is about write concurrency and the sweep writes nothing itself.

## 4. What is still open

- The three protocol runs, with their citations, before `changesRequested`, `reapableSince` and
  `lastCommitAt` stop being `unread` — the pull-request ladder is silent until then, honestly, by
  the `factsUnread` finding.
- The `pull_request_review` subscription question the matrix already records: the sweep does not
  need it, because it reads reviews rather than waiting to be told.
