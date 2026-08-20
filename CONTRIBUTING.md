# Contributing

Thanks for being here. This repository is a design-and-implementation project for a hosted GitHub
App, and it is deliberately test-heavy: most rules you meet are enforced by a check rather than by
review, so the suite tells you when something is wrong faster than a maintainer can.

## Setup

```bash
pnpm install
pnpm -r test
```

That is the whole setup. **No tokens, credentials, or GitHub App configuration are needed for any
tracked code** — every test runs offline, including the ones that walk a real captured webhook
payload end to end.

Node 24 or newer — every package's `engines` floor. `node:sqlite` (which the store depends on) only
needs 23.4 unflagged, but Node 23 was never an LTS release and is past its own end of life, so the
floor tracks the oldest runtime CI actually tests: both 24 and 25, because that API is still
experimental and can change between majors.

Useful while working:

```bash
pnpm --filter @hiero-hackers/automation-core test
```

```bash
pnpm lint
```

```bash
pnpm format
```

CI runs `pnpm format:check` and fails the build on a formatting difference, so run `pnpm format`
before pushing — or let your editor do it. Prettier is formatter-only here and markdown is excluded;
what it covers is [`.prettierignore`](.prettierignore)'s business, not this page's.

## Sign your commits (DCO)

Every commit needs a Developer Certificate of Origin sign-off:

```bash
git commit -s -m "your message"
```

That appends a `Signed-off-by:` line. It is not a copyright assignment — it is you certifying that
you wrote the change, or have the right to submit it, under the project's licence. The full text is
at [developercertificate.org](https://developercertificate.org/).

If you forget on your last commit: `git commit --amend -s --no-edit`.

The repository's DCO check enforces this on every pull request. `-s` is the required sign-off; GPG/SSH
commit signing (`-S`) is a separate optional mechanism and is not required by this guide.

## Which issue to pick

Every issue carries **exactly one** difficulty label, and the ladder runs:

[`good first issue`](https://github.com/hiero-hackers/sdk-automations/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)
→ [`beginner`](https://github.com/hiero-hackers/sdk-automations/issues?q=is%3Aissue+is%3Aopen+label%3A%22beginner%22)
→ [`intermediate`](https://github.com/hiero-hackers/sdk-automations/issues?q=is%3Aissue+is%3Aopen+label%3A%22intermediate%22)
→ [`advanced`](https://github.com/hiero-hackers/sdk-automations/issues?q=is%3Aissue+is%3Aopen+label%3A%22advanced%22)

The label descriptions say what each tier assumes; the issue body says what the task needs. Start at
`good first issue` — the guidance in an issue gets thinner as the tier rises, on purpose.

## Working together

These are here because each one has actually cost this project time.

- **Claim one issue at a time.** Comment on the issue to claim it, finish it, then take the next.
  Self-assigning several at once blocks other contributors from work you are not yet doing.
- **You must be able to explain every line you submit.** AI assistance is fine and normal here — the
  maintainer uses it. What is not fine is submitting code or prose you cannot defend in review. See
  the [AI policy](AI_POLICY.md).
- **Answer the feedback on your open pull request before starting new work.** A review comment
  waiting for a reply is the most expensive thing in the queue; opening more work while it sits
  means nothing lands.
- **Small and finished beats large and nearly.** A focused pull request that makes the suite green
  is worth more than a broad one that needs three rounds.
- **A large change divides so that every piece merges green with the system still running.** Isolation
  comes from seams that already exist and from environment gates, not from feature flags. Measurement
  is its own piece and carries no code. Removing the scaffolding is the last piece, and it is what
  closes the issue. [`design/guides/adapter.md`](design/guides/adapter.md) is the worked example.

## Ground rules for changes

Each of these is a rule the register earned the hard way; follow the link for the reasoning rather
than taking it on faith.

- **One fact, one place.** If a value, list, or rule already exists somewhere, derive it — do not
  restate it. This is the single most repeated finding in the project ([`design/decisions.md`](design/decisions.md)).
- **Every check gets a negative control.** A test that cannot fail is not a check; each invariant in
  [`packages/dev/checks/`](packages/dev/checks/) carries a "proves the check can fail" case, and yours should too.
- **Never weaken a gate to make it pass.** The mutation threshold in
  [`packages/core/stryker.config.json`](packages/core/stryker.config.json) breaks the build below 90 — if you
  cannot reach it, the answer is a better test, not a lower number.
- **A claim in a document becomes an invariant.** If your change asserts something is true of this
  repository, expect to be asked which check keeps it true ([`packages/dev/checks/`](packages/dev/checks/)).
- **Credentials and raw captures are never tracked.** The lab's local-only layer holds sandbox
  secrets and unscrubbed payloads; a test enforces this and a `git add -f` will fail the build
  ([`packages/dev/lab/README.md`](packages/dev/lab/README.md)).
- **Comments carry constraints, not narration.** Say what must stay true and cite the decision; the
  story belongs in the register ([`design/guides/testing.md`](design/guides/testing.md)).

## Where the "why" lives

- [`packages/core/README.md`](packages/core/README.md) — the glossary and the reading path.
  **Start here** if the vocabulary is new.
- [`design/architecture.md`](design/architecture.md) — the system as diagrams, each naming the code
  or test that falsifies it.
- [`design/decisions.md`](design/decisions.md) — the register: every non-obvious choice, its
  reasoning, its costs, and what would reopen it.
- [`docs/`](docs/README.md) — user-facing configuration guide, with its closed code vocabularies
  guarded by repository checks and its explanatory prose owned by review.

Pull requests are reviewed by the maintainers listed in [`.github/CODEOWNERS`](.github/CODEOWNERS).
By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
