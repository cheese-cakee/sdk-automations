# Capability designs — where each one lives

A design doc lives here until its capability has a folder, and then it moves into that folder:
`packages/capabilities/src/<name>/design.md`, beside the code it is the standard for. The rule
has one reason — a design and its `evaluate` drift the moment a reader has to go looking for
the other one (D131).

| Capability | Design |
|---|---|
| `intake` | `packages/capabilities/src/intake/design.md` |
| `prDashboard` | `packages/capabilities/src/prDashboard/design.md` |
| `inactivity` | `packages/capabilities/src/inactivity/design.md` |
| `configReport` | `packages/capabilities/src/configReport/design.md` |
| `advancement` | [`advancement.md`](advancement.md) — no folder yet |
| `assignment` | [`assignment.md`](assignment.md) — no folder yet |
| `notifications` | [`notifications.md`](notifications.md) — no folder yet |
| `onboarding` | [`onboarding.md`](onboarding.md) — no folder yet |
| `reviews` | [`reviews.md`](reviews.md) — no folder yet |
| `merged` | [`merged.md`](merged.md) — no folder yet |
| `why` | [`why.md`](why.md) — no folder yet |

Write a new design here, in the shape the `capability-design` skill describes.
Move it the day its folder is created, and update this table in the same breath.
