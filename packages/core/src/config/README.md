# config/ — what a repository asked for

Six files turning a YAML file in someone's repository into a `RepositoryConfig` the rest of the
platform can trust, or into every reason it was rejected. The rules being implemented live in
[`design/config/schema.md`](../../../../design/config/schema.md) §2–§4; this directory is those
rules as code.

Two properties hold throughout, and most of the design follows from them:

- **Nothing here throws, and nothing does I/O.** Every rejection is a returned value. The shell
  reads the bytes; this layer is pure text-in, result-out.
- **It fails closed, whole-file.** One error anywhere yields no configuration at all — never a
  partial one (D38). But every error is collected first, so a maintainer with three mistakes is
  told about all three rather than made to fix them one push at a time.

## The path a file takes

```mermaid
flowchart TB
    TXT["YAML text from a repository"]
    DOC["document.ts — syntax, alias budget, duplicate keys"]
    PAR["parse.ts — orchestrates, fails closed"]
    VAL["validate.ts — one reader per section"]
    RES["ConfigResult — a config, or every error at once"]
    MAP["mappings.ts — a label, read back to a meaning"]
    TXT --> DOC --> PAR --> VAL --> RES
    RES -.->|"later, per delivery"| MAP
```

`document.ts` is the only file that knows YAML exists, which is where the `yaml` dependency stays
quarantined. Everything after it works on a plain value.

`mappings.ts` is not part of the parse at all — it runs much later, once per webhook delivery,
turning the repository's label strings back into platform meanings for the normalizer.

## The files

| File | The question it answers |
|---|---|
| [`schema.ts`](schema.ts) | What words may a configuration use, what shape may it have, and what comes back from checking it? Vocabulary, `RepositoryConfig`, and the error types. |
| [`validate.ts`](validate.ts) | Is each section well formed, and what does it contribute? One function per section, each total and independent. |
| [`parse.ts`](parse.ts) | Given an already-parsed value, is the whole thing acceptable? Runs the sections and assembles or rejects. |
| [`document.ts`](document.ts) | Is this *text* even a YAML document? Syntax, the alias budget, and the duplicate-key trap. |
| [`mappings.ts`](mappings.ts) | Which meaning, if any, does this repository label carry? |
| [`index.ts`](index.ts) | The barrel, so consumers name the concern rather than the file. |

## Two things that catch people

**`parseMappings` is not in `mappings.ts`.** It lives in `validate.ts` with the other section
readers, because it validates the `mappings:` block of a document. `mappings.ts` answers the
opposite question — given a label on the wire, which meaning is it? Two different things share
the word.

**`check*` and `parse*` differ in what they return.** `checkTopLevelKeys` and `checkSchemaVersion`
return problems only. `parseMode`, `parseCapabilities`, `parseMappings` and `parsePrincipals`
return a `Checked<T>` — a value *or* problems, never both, so a value that exists is known good
without consulting a list somewhere else.

Both are naming accidents rather than design, and both are worth fixing.

## Where the rules are enforced, not just stated

The vocabularies here are locked to the documents that describe them:
[`packages/checks/test/docs.test.ts`](../../../checks/test/docs.test.ts) asserts that
`docs/configuration.md`'s tables match `TOP_LEVEL_KEYS`, `REPOSITORY_MODES` and
`ConfigErrorCode` in both directions, and
[`packages/checks/test/examples.test.ts`](../../../checks/test/examples.test.ts) parses every
shipped example in `docs/examples/` through the real entry point on each run. A rejection
corpus covering every error code lives in
[`packages/core/test/config/documents.ts`](../../test/config/documents.ts), exhaustive by a
mapped type — adding a code fails compilation until a document reaches it.
