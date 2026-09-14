# merged — when a pull request merges, thank the author and point at what comes next

Not built: phases 1, 2.

## What the output looks like

The comment, same tier:

> 🎉 Merged — thank you, @alice! This closed #1632.
>
> If you'd like another, these are open and unassigned at the same level:
> - #1640 Handle an empty transaction memo (configured link)
> - #1651 Document the mirror-node retry policy (configured link)
>
> Comment `/assign` on one to take it.

The comment, next tier reached:

> 🎉 Merged — thank you, @alice! This closed #1632, your second good first issue here.
>
> You've cleared the good-first-issue tier — these are open at the next level, beginner:
> - #1655 Validate account ids before signing (configured link)
> - #1660 Add a retry to the receipt query (configured link)
>
> Comment `/assign` on one to take it. cc @mentors-team — @alice is moving up a tier.

The comment when the count could not be read:

> 🎉 Merged — thank you, @alice! This closed #1632.
>
> I couldn't read your completed issues just now, so no recommendation this time.

Issue titles are attacker-controlled and rendered inert; the `/assign` sentence appears only when
`mappings.commands.assign` is mapped.

## What the config looks like

Thanks only:

```yaml
capabilities:
  merged:
    enabled: true
```

Thanks and a recommendation, walking the ladder:

```yaml
capabilities:
  merged:
    enabled: true
    recommend:
      enabled: true
      count: 3 # at most this many issues, newest first
      onlyWhen: [ready] # meaning-set: recommend only issues in these positions; empty = any open, unassigned issue
      ladder: # completions at a tier before the next tier is recommended
        goodFirstIssue: 2
        beginner: 3
        intermediate: 5
    cc: mentorTeam # optional — pinged only when the author is recommended a NEW tier

mappings:
  labels:
    ready: "status: ready for dev"
  skills:
    goodFirstIssue: "skill: good first issue"
    beginner: "skill: beginner"
    intermediate: "skill: intermediate"
    advanced: "skill: advanced"

principals:
  mentorTeam: "hiero-ledger/hiero-sdk-python-mentors"
```

`recommend` demands `mappings.skills`; enabling it without the family rejects the file. A
tier absent from `ladder` has no threshold and is never advanced past. The author's tier is the
highest tier of any issue this pull request closed; a pull request that closed no skill-labelled
issue is thanked and recommended issues at the lowest mapped tier.

## How it works

When a pull request merges, posts one managed comment on it: thanks by name, the issues it closed,
and up to a few open, unassigned issues at the author's current or next skill tier that they could
take next.

Acts on the merge and nothing else. Never labels, never assigns, never counts anything toward a
role — that is `advancement`'s. Never recommends an issue that is assigned, paused, or already
linked to an open pull request.

The recommendation walks the skill ladder: an author whose completions at their tier have reached
the ladder's threshold is pointed at the next tier; one who has not is pointed at more of the same.
It composes with `assignment` through the same skill mappings and completion count, never by
reading its comments.

```mermaid
flowchart LR
    M["pull_request — merged"] --> B{"author a person, not a bot?"}
    B -->|no| N["nothing"]
    B -->|yes| T["thanks — the closed issues named"]
    T --> R{"recommend enabled and skills mapped?"}
    R -->|no| P["postManagedComment — thanks, kind notice"]
    R -->|yes| C{"completions at the author's tier ≥ ladder threshold?"}
    C -->|"unknown"| P2["thanks only — say the recommendation could not be read"]
    C -->|yes| NX["next tier: list open, unassigned, unlinked issues there"]
    C -->|no| SM["same tier: list open, unassigned, unlinked issues there"]
    NX --> P3["postManagedComment — thanks + issues + cc"]
    SM --> P4["postManagedComment — thanks + issues"]
```

| Read | Resolver | Unknown means |
|---|---|---|
| the author is a person | `isAutomationActor` | nothing posted |
| completions at a tier | `completedCount({ login, tier })` — closed issues carrying the tier's label the author was assigned to, this repository | thanks only, with one honest line |
| candidate issues | `openIssues({ tier, unassigned: true, onlyWhen })` — the list read the matrix confirms, filtered to issues with no open linked pull request | thanks only, with one honest line |

| Phase | Ships | Needs first |
|---|---|---|
| 1 | thanks, with the closed issues | `merged` on the pull-request facts (exists as `closedBy`) and `author` (a plain field) · `links.issues`, which exists but is read by the SWEEP alone: on a `pull_request` trigger the group is unread, so this is a producer question before it is a capability |
| 2 | the recommendation and the ladder walk | `completedCount` and `openIssues` resolvers — the same closed-issue and list reads `assignment` needs, gated on the endpoint matrix · `mention` (exists) |

| Declaration | Value |
|---|---|
| `triggers` | `pull_request` |
| `facts` / `needs` | `pullRequest`, needing `links` — which the `pull_request` producer does not read, so this pair does not boot as written |
| `resolvers` | `isAutomationActor` (exists) · `completedCount` (new, shared with assignment) · `openIssues` (new) |
| `intents` | `postManagedComment` (`notice`, one per pull request) |
| `requiredMappings` | `skills` when `recommend` is enabled; `labels` for `onlyWhen`'s meanings |
| Permissions | repository: `issues:read`, `pull_requests:read`, `issues:write` · organization: none |
| Platform needs | durableState: none · crossItemCoordination: false · externalDelivery: false |

The `pull_request` producer reads `readiness` alone on a pull-request record, so `links` on that
trigger is a boot error naming `sweep` as the only producer that reads it. The payload carries no
linked issues — they are a separate read — so "add the row" is not the fix: the design owes a
choice between the schedule as its trigger and the fact-shape change `design/trace.md` §6 prices.

## Verified by

| Scenario | Proves |
|---|---|
| Pull request merged, closing one issue, recommend off | one thanks naming the issue |
| Closed by a human without merging | nothing — closure is not a merge (D47) |
| Merged by a bot author | nothing |
| Merged, author below the tier threshold | thanks plus issues at the same tier |
| Merged, author reaches the threshold | thanks plus issues at the next tier, the cc pinged once |
| Author already at the top mapped tier | thanks plus issues at that tier; no cc |
| Candidate issue is assigned, paused, or has an open linked pull request | not recommended |
| Fewer candidates than `count` | the ones there are; none is not an error |
| No candidates at all | thanks, and one line saying nothing is open at that level |
| `completedCount` or `openIssues` cannot answer | thanks with the honest line; never a guessed list |
| Redelivered `closed` event | one comment, updated in place |
| Closed no skill-labelled issue | thanks; recommendations at the lowest mapped tier |
| `recommend` enabled without `mappings.skills` | rejected with the file |
| `commands.assign` unmapped | the `/assign` sentence is omitted |
| Hostile issue title | renders inert |
| `mode: dry-run` | the comment named as `wouldApply`; nothing posted |
