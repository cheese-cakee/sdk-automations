# Fieldwork audit — frozen

Evidence, not documentation. These files record what the Hiero SDK repositories — C++, JavaScript,
Python — actually did in July 2026: their labels, their services, their coupling, their tests.
Decisions in [`../decisions.md`](../decisions.md) and the workflow tables in `packages/core/src/workflow/`
cite specific files here as the ground they stand on.

**Frozen on 2026-07-17.** Nothing here is edited, even when wrong — a correction would silently
change what a decision appears to have been based on. If the fieldwork is later found to be
mistaken, the correction is a new decision row citing the mistake, and if the repositories change,
that is a new audit, not an update to this one.

| File | What it records |
|---|---|
| `services.md` | The cross-SDK synthesis — start here |
| `labels-{cpp,js,python}.md` | Every label in use, per repository |
| `services-{cpp,js,python}.md` | The automation each repository runs today |
| `coupling-{cpp,js}.md` | How those automations entangle |
| `deep-dive-cpp.md`, `testing-cpp.md`, `principles-review-cpp.md` | The C++ repo in depth |
