# Quickstart

> The App is in development and not yet installable. These pages describe the configuration it ships with.

Set up in two minutes: one file, one merge, no per-repository installation.

## Add the file

**1.** Create `.github/hiero-automations.yml`:

```yaml
schemaVersion: 1
mode: active

capabilities:
  intake:
    enabled: true

mappings:
  labels:
    awaitingTriage: "status: triage"
    ready: "status: ready for dev"
    inProgress: "status: in progress"
    needsReview: "status: needs review"
    blocked: "status: blocked"
```

**2.** Edit the label names on the right to match your repository's labels. Only labels you list
here are ever touched.

**3.** Merge to your default branch. Configuration changes only take effect from there — a config in
an open pull request does nothing until it lands.

That is the whole setup.

## What happens next

New issues get triaged. Items move between the labels you mapped as work progresses. Everything the
App does appears in its reports, with the reason attached.

Three things it will not do, ever:

- **Overrule you.** If a human touched an item after the App decided, the App drops its plan.
- **Pause work.** It reads `blocked`; it never sets it. That label is yours.
- **Act destructively without warning.** Anything irreversible gets a visible warning and a grace
  period first, and cancels itself the moment someone responds.

## Choosing a mode

`mode` sets how much the App is allowed to do. Most repositories run `active`.

| Mode | Use it when |
|---|---|
| `disabled` | You want the App inert without uninstalling it |
| `observe` | You want to see what it notices before letting it act |
| `dry-run` | You want the exact actions it would take, recorded and reviewable |
| `active` | You want it to do the work |

`observe` and `dry-run` are there if you want them, not steps you have to pass through. Changing mode
is a one-word diff, reviewed like any other change.

## Common setups

**Triage only** — label incoming issues, touch nothing else:

```yaml
schemaVersion: 1
mode: active
capabilities:
  intake:
    enabled: true
mappings:
  labels:
    awaitingTriage: "status: triage"
```

**Full workflow with pull-request checks:**

```yaml
schemaVersion: 1
mode: active
capabilities:
  intake:
    enabled: true
    settings:
      announce: true
  prQuality:
    enabled: true
mappings:
  labels:
    awaitingTriage: "status: triage"
    ready: "status: ready for dev"
    inProgress: "status: in progress"
    needsReview: "status: needs review"
    needsRevision: "status: needs revision"
    readyToMerge: "status: ready to merge"
    blocked: "status: blocked"
principals:
  maintainerTeam: hiero-sdk-js-maintainers
```

## Or copy a tested file

Every file in [`docs/examples/`](examples/) is parsed by our test suite on every commit —
copy the one closest to what you want and edit the label names:

| File | What you get |
|---|---|
| [`active.yml`](examples/active.yml) | The full setup above: triage, PR checks, one capability staged |
| [`observe-only.yml`](examples/observe-only.yml) | The same repository, reporting instead of acting |
| [`minimal.yml`](examples/minimal.yml) | Reports only, nothing enabled — the smallest useful file |
| [`empty.yml`](examples/empty.yml) | Nothing at all, spelled out |

## What's next

- **[Configuration](configuration.md)** — every key defined, with types, defaults, and every error code
- **[Troubleshooting](troubleshooting.md)** — what each reported code means, and what to do about it
