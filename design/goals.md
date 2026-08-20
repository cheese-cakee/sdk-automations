# Project Goals

## The problem

Maintainers face load to grow a contributor ecosystem: PRs pile up unassigned and unlinked, issues sit untriaged, stale work isn't reclaimed. Building and maintaining such contributor-facing automations takes maintainer time away from the repo's core goals. There is a use-case to abstract contributor-facing automations away from the repositories.

What we believe about maintainers, and therefore build for, is recorded in [`assumptions.md`](assumptions.md).

## Vision

Turn repeated repository contributor-facing automation into a **hosted, configuration-driven GitHub App**. A repository
installs one App and switches on/off and configures the features it wants.

## Goals

1. **Each capability is separate.** Each capability can switch on/off and be configured without impacting other capabilities.
2. **Every repository makes a configuration-driven choice.** A repository declares its choices in an
   `automations.yml` file on its default branch, configuring labels, thresholds, and contributor rules
   within each capability it enables.
3. **Each config combination safely defaults.** No configuration means no workflow-changing writes. Every user-facing capability defaults to off.
4. **The project is capability neutral.** The team starts with the shared App foundation, then adds capabilities that maintainers have
   asked for. These can be removed if no longer popular.
5. **The App uses minimal and clearly explained permissions.** Each released product slice uses the smallest
   practical App permission set for its supported capabilities, and the App never needs permission to change
   repository code.
6. **The App must be safe and trustworthy.** Destructive actions, such as automatic closure or
   unassignment, require an advance warning and a grace period, and they must be reversible. It warns before
   it closes or unassigns, and explains each action in a comment.

## Non-goals

- Absorbing CI / build / release pipelines — those stay as native Actions per repo.
- A one-size-fits-all bot: the point is configurable subsets, not a fixed suite.
- Inventing workflow policy without maintainer demand. Existing automation is the starting evidence, and
  new behavior needs a clear user need.
- Configuration inheritance: the first version does not inherit configuration from an organization `.github`.
