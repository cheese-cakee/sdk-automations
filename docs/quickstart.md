# Quickstart

> The App is in development and not yet installable. These pages describe the configuration it ships with.

Set up in two minutes: one file, one merge, no per-repository installation.

## Add the file

**1.** Create `automations.yml` in your repository root:

```yaml
schemaVersion: 1
mode: dry-run

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

**3.** Merge to your default branch; a config in an open pull request does not take effect. With App
credentials the shell reads that branch. Credential-free development and CI may point `CONFIG_FILE`
at a local copy.

That is the whole setup.

## What happens next

The App wakes on two things: a webhook from GitHub, and its own daily schedule, which sweeps every
open issue and pull request for the capabilities that judge clocks. Either way it records a report
per delivery naming every decision and why. Writes happen only in `active`, and only when the
endpoint was started with a write path wired, which is not the default; anything the App would
close or release is warned about first, and the warning is honoured. [Capabilities](capabilities.md)
says what each automation does and what it may write.

## Choosing a mode

The runnable shell supports `disabled`, `observe` and `dry-run`. It rejects `active` configuration before
making a decision unless the endpoint was started with a write path wired, which is not the default.

| Mode | Use it when |
|---|---|
| `disabled` | You want every returned intent refused; enabled capability and resolver evaluation still runs |
| `observe` | You want a non-writing decision record; today it includes record-only requested effects |
| `dry-run` | You want the same non-writing record, plus a `wouldApply` line naming each change the App would make |
| `active` | Unsupported unless the endpoint wires a write path |

`dry-run` is the rehearsal to read before `active`: nothing is written, and every effect that would
be is named.

## Common setups

**Triage only** — label incoming issues, touch nothing else:

```yaml
schemaVersion: 1
mode: dry-run
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
mode: dry-run
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
| [`full.yml`](examples/full.yml) | Every capability on, every mapping family filled, every option with a comment — the catalogue |
| [`inactivity.yml`](examples/inactivity.yml) | The scheduled capability alone: reminders and releases, with the defaults |
| [`active.yml`](examples/active.yml) | A reserved active configuration; rejected unless the endpoint wires a write path |
| [`observe-only.yml`](examples/observe-only.yml) | The same repository, reporting instead of acting |
| [`minimal.yml`](examples/minimal.yml) | Reports only, nothing enabled — the smallest useful file |
| [`empty.yml`](examples/empty.yml) | Nothing at all, spelled out |

## What's next

- **[Capabilities](capabilities.md)** — each automation, what it needs mapped, and what it may write
- **[Configuration](configuration.md)** — every key defined, with types, defaults, and every error code
- **[Troubleshooting](troubleshooting.md)** — what each reported code means, and what to do about it
