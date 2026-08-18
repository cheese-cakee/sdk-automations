# automation-testkit (test-only support)

The support that more than one package's tests need: the five **captured webhook payloads** from the
2026-08-07 session (protocol 7.1, scrubbed and human-reviewed), each carrying its own provenance, and
the two temp-dir helpers — callback and hook forms — that suites kept separately rewriting.

Nothing here runs in production and nothing here can kill a mutant — the same shape, and the same
reason, as [`checks/`](../checks/README.md).

## Three rules

**A fixture is reached through the module, never through a path.** `capture("issues.opened.json")`
and `WEBHOOK_CAPTURES`, not `new URL("../fixtures/…")` from another package. This is the
`document.ts` lesson (D82) stated as an interface: Stryker's sandbox is the mutated package's own
directory, so a fixture read by path from somewhere above it is simply *absent* when the mutants
run — the tests still pass, kill nothing, and score 0.00%. A fixture reached through a package
export travels into the sandbox with the dependency. There is deliberately no exported directory
path, because there is then no path to leak.

**It is test-only, in both directions.** A package declares it under `devDependencies` and nowhere
else, and imports it from `test/` and nowhere else. Both halves are enforced by
[`architecture.test.ts`](../checks/test/architecture.test.ts) — a manifest edge from
`dependencies`, or an import from `src/`, is a violation with its own message.

**Admission: a helper graduates here when a SECOND package needs it.** One package's helper belongs
in that package's `test/`. Two packages copying the same helper is the trigger, and it was this
package's own origin — two shell suites were reading a fixture out of core's private test directory,
which no rule permitted and no check could see.

The corollary is what stays out. Config and declaration builders are the obvious next candidates and
they are refused: they would need `core`, and core's own tests need this package, so admitting them
would create exactly the cycle the architecture check exists to reject. That refusal is recorded in
`ALLOWED` as an empty set, not as prose alone.

## What it exports

| Export | What it gives you |
|---|---|
| `WEBHOOK_CAPTURES` | Every capture, listed rather than discovered — a directory read would go quietly empty |
| `capture(name)` | One capture by filename; a wrong name throws with the available ones, not `ENOENT` |
| `WebhookCapture` | `name`, `event`, `capturedAt`, `protocol`, `synthetic: false`, and `bytes()` / `json()` |
| `withTempDir(prefix, fn)` | Runs a synchronous or asynchronous block with a fresh temporary directory, guaranteed removed on return, throw, or rejection |
| `useTempDir(prefix)` | The hook form (D114): registers the `beforeEach`/`afterEach` pair; the returned `TempDirHandle`'s `dir` / `file(name)` reach the current test's directory |

`event` is derived from the filename — `<event>.<action>.json` is the capture protocol's naming
scheme, so the `X-GitHub-Event` header is recoverable rather than restated.

## Running its tests

```bash
pnpm --filter @hiero-hackers/automation-testkit test
```

They check what only a test can see: that every capture still parses, that its declared `event`
still matches its filename, that `withTempDir` cleans up on the throwing path, and that `useTempDir`
hands each test a fresh directory and removes the previous one.
