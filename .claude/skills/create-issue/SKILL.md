---
name: create-issue
description: Author a GitHub issue for this repo that fits the difficulty ladder, label rules, and house documentation style. Use when asked to create, draft, or seed issues.
---

# Creating issues for sdk-automations

Target repo: `hiero-hackers/sdk-automations`. Create with `gh issue create -R hiero-hackers/sdk-automations`.

## The difficulty ladder — every issue gets exactly ONE tier label

| Tier | Time | Prerequisites | Body style |
|---|---|---|---|
| `good first issue` | ~4h | none — no repo or Hedera context | **Guided walkthrough**: numbered steps, exact files, how to verify, "Done when" checklist. Write for someone who has never seen the codebase. |
| `beginner` | ~8h | can fork/branch/PR unaided | **Context + suggested approach**: ordered steps with the sharp edges named; design calls left to the contributor. |
| `intermediate` | ~25h | navigates this repo comfortably | **Goals and constraints**: problem, impact, acceptance criteria, risks. Do NOT prescribe the approach. |
| `advanced` | ~30h+ | knows the decision register / safety model | **Problem space**: the question itself may need discovering. Cite the relevant D-rows and name what is already decided vs open. |

Pick the tier from what the work demands, not from how much you write — then write the amount that tier calls for. Add one type label (`enhancement`, `documentation`, `bug`). Nothing else. `help wanted` was deleted deliberately; do not recreate it.

## Body conventions (all tiers)

- Open with a one-paragraph **Context** that says why this matters *here* — cite the file, the D-row in `design/decisions.md`, or the incident that motivates it. This repo's issues carry their own justification.
- **Acceptance criteria as checkboxes.** Where the work adds a check or guard, one criterion must be its negative control ("proves the check can fail") — house rule.
- **Pointers, not prose dumps**: name 1–3 files or a working reference to crib from. Org sibling repos are good references (e.g. `hiero-hackers/hiero-x402` for CI workflows, `hiero-hackers/analytics` for issue templates) — link the exact file.
- **One fact, one place**: link to where a rule lives (`.prettierignore`, a D-row, `ci.yml`'s conventions) rather than restating it. An issue that restates a rule will outlive the rule.
- Name what is **explicitly out of scope** when a helpful contributor would plausibly overreach (with the trigger for when it comes into scope).
- Never claim the repo does something without checking — read the file first. Issues here are treated as citations.

## Blocked work

Use GitHub's native dependency, not just prose — but lead the body with the blocker too:

```bash
gh api -X POST repos/hiero-hackers/sdk-automations/issues/<N>/dependencies/blocked_by \
  -F issue_id="$(gh api repos/hiero-hackers/sdk-automations/issues/<BLOCKER> -q .id)"
```

## House context worth citing

- `design/decisions.md` — the register; rows D1–D89+. An issue implementing a row's "notes" column should cite the row.
- `docs/to-do.md` — recorded gaps with their unblocking conditions; check an issue isn't already recorded there with a different trigger.
- `checks/` — the invariant package; issues adding "keep X true" checks belong there, one file per invariant or watched target.
- CI conventions: SHA-pinned actions with version comments, least-privilege permissions per job, never `pull_request_target` (`.github/workflows/ci.yml` explains each).

## After #44 lands

Issue templates in `.github/ISSUE_TEMPLATE/` will carry the tier banners and boilerplate. From then on: fill a template's "The task" section rather than authoring the banner by hand, and keep this skill's job to tier selection, body conventions, and the gh mechanics.