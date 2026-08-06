# Example configurations

Every file here is parsed by the test suite. They are not illustrations of the schema — they are the
schema's only worked examples, and a change that breaks one fails the build.

`checks/test/examples.test.ts` reads this directory through `parseConfigDocument`, the same entry
point the shell will use on a real repository.

## The valid ones

| File | What it shows |
|---|---|
| `empty.yml` | A file with nothing in it. Identical to having no file: `observe`, no writes. |
| `minimal.yml` | The smallest configuration that says anything — three lines. |
| `observe-only.yml` | A real repository with mappings and a capability, still writing nothing. |
| `active.yml` | The same repository writing, plus a capability staged with `enabled: false`. |

`observe-only.yml` and `active.yml` are a pair on purpose. The test asserts that going from one to the
other changes the **mode** and not the **vocabulary** — a repository that re-labels itself on the way to
writing is not staging its adoption, it is guessing.

## Where the rejections live

Not here. Every way a configuration can be *wrong* is in `core/test/config/documents.ts` — thirty
documents, at least one per `ConfigErrorCode`, each asserted to produce that code and no other. Adding a
member to `ConfigErrorCode` fails compilation until a document reaches it.

They are in the package rather than in this directory for a reason worth knowing: Stryker's sandbox
contains `core/` and nothing above it, so a fixture at the repository root is invisible to mutation
testing. As files here they ran, passed, and measured nothing.

## What is deliberately not decided here

These files show the SHAPE of a configuration. They do not fix the path the App reads it from, and
`capabilities.*.settings` is opaque to the platform — the keys under `intake` and `prQuality` are those
capabilities' own contracts, validated by them and not by the schema.
