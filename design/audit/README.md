# Fieldwork audit — frozen

Evidence, not documentation. These files record what the Hiero SDK repositories — C++, JavaScript,
Python — actually did in July 2026: their labels, their services, their coupling, their tests.
Decisions in [`../decisions.md`](../decisions.md) and the workflow tables in `packages/core/src/workflow/`
cite specific files here as the ground they stand on.

**Evidence frozen on 2026-07-17.** Observations, counts, grades, and conclusions are never rewritten, even
when later found wrong — a correction is a new decision row, and repository change is a new audit.
Repository-maintenance edits may update paths or links after a file move, but must not change an evidentiary
claim. This distinction keeps the archive navigable without silently changing what a decision relied on.

| File | What it records |
|---|---|
| `services.md` | The cross-SDK synthesis — start here |
| `labels-{cpp,js,python}.md` | Every label in use, per repository |
| `services-{cpp,js,python}.md` | The automation each repository runs today |
| `coupling-{cpp,js}.md` | How those automations entangle |
| `deep-dive-cpp.md`, `testing-cpp.md`, `principles-review-cpp.md` | The C++ repo in depth |
