# Installing

> The App runs in a personal development sandbox. It is not hosted for general use yet. These pages describe its current configuration and how to operate it.

The GitHub Action is experimental and pre-1.0: expect it to change, and start in `dry-run`.

The Action runs the same engine inside your own repository's workflow, with no server to host.

## What to add

Two files, both merged to your default branch:

1. `.github/workflows/sdk-automations.yml`, a copy of
   [`examples/sdk-automations.workflow.yml`](examples/sdk-automations.workflow.yml).
2. `sdk-automations.yml` in the repository root, the configuration the [quickstart](quickstart.md)
   describes.

A workflow in an open pull request does not run for your repository; merge it first.

## What the permissions grant

The workflow's `permissions` block gives the run `contents: read`, `issues: write` and
`pull-requests: write`, and nothing else. That is the ceiling: whatever the configuration says, the
run cannot write anywhere those three do not reach. Do not widen it.

## Pinning

`@v1` moves on each release, so you get fixes without editing the file. To freeze the engine, pin
the release's full commit SHA instead and update it yourself.

## Why there is no checkout step

The Action reads your configuration through the API, so it never needs your code. The workflow
runs on `pull_request_target`, which carries this repository's token; a checkout there would run a
fork's code with that token. Never add one.

## Arming writes

Two gates stand between a run and a write: the configuration's `mode`, and the Action's
`arm-writes` input. The example ships with `arm-writes: "false"`. Until it is `"true"`, a
configuration that says `active` is decided as `dry-run`, and the job summary says so. The pull
request that changes it to `"true"` is the approval. Make it after you have read the dry-run
records and are content with what they show.

## Another token

The default token is the workflow's own, and the run recognises its earlier comments as the
runner's. If you pass an App's installation token as `token`, set `bot-login` to that App's
`<slug>[bot]` and `app-id` to its id, or the run will not know its own comments and will post a
fresh one each time. A personal token is not supported: its comments read as a person's.

## Turning it off

Use **Disable workflow** on the workflow's page in the Actions tab, or delete the workflow file.
Either stops every run at once; nothing else needs undoing.

## Reading a run

Each run writes a job summary that lists every item it decided, the decisions and effects for each,
and their codes. [Troubleshooting](troubleshooting.md) explains every code. A run that fails
names the event that failed, and the job turns red.

GitHub switches off `schedule` workflows in a repository with no commits for 60 days. The hourly
sweep then stops without a failed run; re-enable the workflow from the Actions tab.
