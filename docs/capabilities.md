# Capabilities

> The App is in development and not yet installable. These pages describe the configuration it ships with.

A capability is one automation you switch on. Each one wakes on something GitHub tells the App —
a webhook, or the App's own schedule — reads the item it was woken for, and asks to write at most
what its row below says. It sees your mappings by their meaning (`awaitingTriage`, never your label's
spelling), its own `settings` block, and nothing another capability was given.

## The shipped capabilities

<!-- generated: capabilities -->
| Capability | What it does | Wakes on | Needs mapped | Settings keys | May write | Design |
|---|---|---|---|---|---|---|
| `intake` | walk a new issue from its opening to triaged, ready work | the `issues` webhook | `labels.awaitingTriage` | `announce` | your mapped labels; a comment it keeps up to date | [design page](../packages/capabilities/src/intake/design.md) |
| `prQuality` | one dashboard comment that tells a contributor what stops their pull request from being ready to review | the `pull_request` webhook | nothing required | none | a comment it keeps up to date | [design page](../packages/capabilities/src/prQuality/design.md) |
| `inactivity` | remind about stalled work, then release it | a schedule (daily stale-assignment sweep) | nothing required | `exemptBlocked`, `remindAfterDays`, `reapAfterDays`, `issues`, `pullRequests` | a comment it keeps up to date; an assignment's release, after a warning; a pull request's closure, after a warning | [design page](../packages/capabilities/src/inactivity/design.md) |
<!-- /generated -->

Three things to read off the table:

- **Settings keys are the ones the App reads today.** A design page's config block may show more,
  labelled as later phases. A key outside the list is refused as `unknownKey` with the exact path,
  whether the capability is enabled or not — see [configuration](configuration.md).
- **Needs mapped** is what the parser insists on before the capability may be enabled. A capability
  may read other meanings when you map them (`inactivity` reads `blocked` and `needsRevision`, and
  the `working` command), and says on its design page which rule each one unlocks.
- **A warning always comes first.** Any write marked "after a warning" is never done on first sight:
  the App posts the warning, waits out exactly the grace it announced, and cancels itself if the
  person acts in the meantime. Those outcomes are `graceRunning` and `activityCancelled` in
  [troubleshooting](troubleshooting.md).

The design page linked from each row is the standard that capability is built to. Its first two
sections — what the output looks like, and what the config looks like — are written for you; the
rest is for the people who build it.

## How the App wakes

**Webhooks.** GitHub POSTs one delivery per event; the App verifies it, records it, and evaluates
every enabled capability that declared that event. Nothing happens for an event no capability
declared.

**The schedule.** Once a day the App sweeps every open issue and pull request and evaluates the
scheduled capabilities against each one, with the clocks a webhook cannot carry: how long an
assignment has been quiet, whether a linked pull request is open, when the last review landed. A
contributor resets their own clock by typing the mapped `working` command in a comment, or by
pushing.

Both paths end the same way: a report per delivery naming every decision and why, and — in
`active` — the writes. In `dry-run` the report names each write the App would have made
instead. [Troubleshooting](troubleshooting.md) lists every code a report can carry.

## Turning one on

```yaml
capabilities:
  intake:
    enabled: true             # consent — literally true, nothing that looks like it
    settings:
      announce: true          # this capability's own keys, from the table above
```

Then map the meanings its row needs. A block the capability cannot read — a number where a boolean
belongs, a ladder that reaps before it reminds — is reported on every delivery that meets it as
`Skipped: settings unusable — capabilities.<name>.settings.<path>: <why>`, and the capability
does nothing until the file is fixed. It never falls back to a default you did not write.

[`docs/examples/full.yml`](examples/full.yml) enables every capability with every option
spelled out; [`docs/examples/inactivity.yml`](examples/inactivity.yml) is the scheduled one alone.

The test suite regenerates the table on this page from the shipped capabilities' own declarations on
every commit (`pnpm contracts`). The explanations around it still require review.
