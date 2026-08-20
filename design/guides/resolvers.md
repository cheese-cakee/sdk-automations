# Shared read-only resolvers

> **Not built — build guide.** The resolvers that exist are listed in
> [`../contracts/catalogue.md`](../contracts/catalogue.md); this document covers the rules they follow
> and the candidates that are not in it. No resolver has an implementation — the adapter does not exist.

## 1. Resolver rules

| Rule | Requirement |
|---|---|
| One reading | One documented source and interpretation per question |
| Read-only | No repository write |
| Normalized | Facts, never GitHub transport objects |
| Declared cost | Permissions, pagination, rate cost, caching, unclear results |
| Memoized rarely | Only where the cache provably hides no newer state |
| Declared use | A capability calls only the resolvers it declares |
| Policy entry | Validated configuration or a selected workflow profile |

- A resolver answers a question more than one capability must ask the same way.
- Read-only is what stops the answer differing by who asked.
- Two are catalogued; every candidate in §2 needs a catalogue review first (D115).

## 2. Candidates the catalogue does not have

| Resolver | Question | Candidate source | Main open issue |
|---|---|---|---|
| `mayPerform` | May this actor act? | repo permissions, teams, deny rules | scopes must stay acceptable |
| `priorityOf` | What priority? | native field, Project field, label map | Project fields cost permissions |
| `eligibleLevel` | Which skill rung? | completion rules over repo or org history | not a universal decision |
| `linkedPullRequests` | Which PRs close it? | GitHub closing references | reverse-lookup cost untested |

- `mayPerform`'s permission and team scopes must remain acceptable to maintainers.
- Project fields may not be wanted at all, on top of the extra permissions.
- Skill policy, credit scope, and completion meaning are not universal decisions.
- `linkedIssues` is catalogued; this reverse direction is not.
- Build only the resolvers the selected first capability requires.
- Adding one is a catalogue review, not a documentation edit.
- It needs a matrix row with a citation, a permission inside the ceiling, and an unclear-result rule.

## 3. Link resolution

- The audited automation answers the issue-to-pull-request question in more than one way.
- Body text and GitHub closing references can disagree.
- A selected capability uses one configured resolver and never a private parser.
- Closing references are the default hypothesis: they match close-on-merge behavior.
- Sandbox cases: several linked issues · several PRs for one issue · missing keywords.
- Sandbox cases: reopened items · forks · inaccessible repositories.

## 4. Authorization

- `mayPerform` does not replace GitHub permissions.
- It combines installation permission, actor repository authority, and capability policy.
- Capability policy is only what GitHub permissions alone cannot express.
- A capability must not invent its own role hierarchy.
- Organization team membership or another broad permission needs a matrix row first.
- The matrix must show the need before the App manifest is expanded.

## 5. Optional skill policy

- `eligibleLevel` exists only where a repository enables skill-based assignment or progression.
- It is not a universal core requirement.
- Requesting repositories decide the rung mappings and prerequisite counts.
- They decide what event counts as a completed contribution.
- They decide whether credit is repository-local or organization-wide.
- They decide how renamed or retired labels affect historical credit.
- They decide how API search delay and rate limits affect an assignment refusal.
- The resolver hides the chosen mechanism, but makes no product decision for maintainers.

## 6. Failure behavior

- An empty answer and an undetermined answer are different values.
- An API failure is never proof of ineligibility, of no linked issue, or of no permission.
- The platform reports which of four states holds: retryable · rate-limited · unpermitted · unanswerable.
- Unanswerable means the current configuration cannot answer the question.

## 7. Questions that remain open

- The first capability selection must determine the first resolver set.
- The adapter experiment must determine pagination and rate costs.
- The configuration design must determine how resolver policy and mappings are supplied.
- Maintainers must decide whether any repository wants the optional skill resolver.
- The project must decide whether reverse issue-to-pull-request lookup requires owned indexing.
