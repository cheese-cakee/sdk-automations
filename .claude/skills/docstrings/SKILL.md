---
name: docstrings
description: Make a TypeScript file readable in this repo — what earns a docstring, how long it may be, where it goes, and what order declarations belong in. Use when adding docstrings, reviewing comment density, compressing comments, or reordering a file.
---

# Docstrings for sdk-automations

Three questions, in order. **What earns a comment**, **how long may it be**, **where does it go**.

## 1. What earns a comment

Four things, and nothing else.

| Earner | Test | Example |
|---|---|---|
| **Identity** | Every exported type, interface, and const gets one line saying what it is. A name alone is ambiguous. | `/** One capability's block in a configuration file. */` |
| **Constraint** | Break this and something fails silently, somewhere else. | `satisfies` rather than a `:` annotation, or the derived unions collapse to `never` |
| **Orientation** | A competent reader cannot predict what this does without running it. | the mapped-conditional derivation in `workflow/meanings.ts` |
| **Non-obvious why** | The shape looks arbitrary or wrong, and there is a forcing reason. | `deriveIdempotencyKey` using JSON, not a delimiter join |

**Two things never earn one:**

- **History.** How we got here, what went wrong before, which finding it closed. That is
  `design/decisions.md`. Cite the row — `(D90)` — and stop. The register holds the story at
  full length, and nobody needs it to change the file correctly.
- **Restatement.** `enabled: boolean` does not need "whether it is enabled".

The deletion test: **remove the comment — what breaks?** If the answer is "nothing, we would
just know less about the past", delete it and cite the row.

## 2. How long

Length follows the earner, not the author's enthusiasm.

- **Identity** — exactly one line. Always.
- **Constraint** — as long as the mechanism takes, and no longer. Naming the rule without the
  mechanism is worse than nothing: it only makes sense to someone who already knows.
- **Orientation** — enough that a reader can **skip**, not enough to teach them everything.
- **Non-obvious why** — one or two sentences. The reason, not the incident.

**Write short declarative sentences, one idea each.** This is the failure that reads as
"unclear" even when the content is right. Register prose belongs in the register:

> ✗ `a field added to the shape and forgotten here is not — an interface cannot be enumerated
> at runtime, so that gap is the unknown-key rule wrongly rejecting a legitimate key`
>
> ✓ `Adding a field to RepositoryConfig does not add it here. Only the reverse is a compile error.`

Three inferences welded together with an em-dash become two plain sentences. Same facts, no
unpacking. If a sentence has more than one subordinate clause, split it.

## 3. Where it goes

**Explain at the top. Keep the body scannable.**

An interface's value is that you can see its shape at a glance. A four-line block in the middle
destroys that — the reader loses the shape while reading about one field.

> **A field comment must fit on one line. If it needs more, it belongs in the type's docstring.**

```ts
// ✗ the shape is unreadable
export interface RepositoryConfig {
    /**
     * The sha of the file this came from. Not read from the document: the
     * shell supplies it through `ParseConfigOptions`. The executor guards
     * in-flight effects on it, so an older revision cannot resume (D45, D77).
     */
    readonly revision: string;
    readonly schemaVersion: 1;
}

// ✓ explanation above, shape visible below
/**
 * A validated configuration, plus the revision it was read from.
 *
 * `revision` is the sha of the file, and the one field nobody writes: the
 * shell supplies it through `ParseConfigOptions`. The executor guards
 * in-flight effects on it, so an intent from an older revision cannot
 * resume (D45, D77).
 */
export interface RepositoryConfig {
    readonly revision: string;
    readonly schemaVersion: 1;
}
```

**One fact, one place — including comments.** Before writing a rationale, check whether the
enforcement site already carries it. `CAPABILITY_NAME_PATTERN` is declared in `schema.ts` and
enforced in `validate.ts`; the hostile-key reasoning lives at the enforcement site, and the
declaration says only what the pattern is for. A rationale in both places is the same defect
the register records a dozen times.

**File headers** are the one comment that is always worth it: what this file owns, what it does
not, and where the neighbours are. `validate.ts` holds the rules, `parse.ts` the entry point.

## 4. What order declarations go in

Comments explain; sequence is what lets a reader build the picture in one pass. The two go
together, which is why they share a skill — a reordering pass always rewrites the comments that
introduce the moved declarations.

**Dependencies read downward.** A declaration appears after everything it names. TypeScript
hoists types, so this compiles either way — which is exactly why it rots silently. In
`schema.ts`, `TOP_LEVEL_KEYS` used `keyof Omit<RepositoryConfig, …>` sixty lines before
`RepositoryConfig` existed, and nothing complained.

**Runtime order is not a preference.** `cleanRecord` must precede `NO_CONFIG` because the
constant calls it. Know which of your constraints are real and which are for the reader.

**Inputs before outputs.** `ParseConfigOptions` comes before `ConfigError` and `ConfigResult`.
A reader follows the direction the data moves.

**Sections match the file header, in the header's order.** If the header promises vocabulary,
shape, and results, deliver them in that order. A header that lists three things while the file
delivers a different three is a small lie that costs a reader a minute every time.

**Banners once a file carries three or more concerns**, house style from `catalogue.ts` and
`store.ts`:

```ts
// ─── Vocabulary ──────────────────────────────────────────────────────
```

Below three concerns, banners are noise. Above three, their absence is.

**Verify a reordering pass the way you verify a comment pass** — sorted declarations must be
identical, so nothing was added or lost while moving things:

```bash
strip() { grep -vE '^\s*(\*|/\*\*|/\*|\*/|//)' "$1" | grep -vE '^\s*$'; }
diff <(strip "$ORIGINAL" | sort) <(strip "$REWRITTEN" | sort) && echo "same set, reordered"
```

## Working on an existing file

1. **Measure first.** `grep -cE '^\s*(\*|/\*|//)' <file>` against its line count. Compare with
   neighbours before assuming a file is the problem — barrels run high and that is fine.
2. **Classify every comment** against the four earners. Most over-long blocks are one earner
   plus three sentences of history.
3. **Never change code in a comment pass.** Copy the file first, then prove it:
   ```bash
   strip() { grep -vE '^\s*(\*|/\*\*|/\*|\*/|//)' "$1" | grep -vE '^\s*$'; }
   diff <(strip "$ORIGINAL") <(strip "$REWRITTEN") && echo "comments only"
   ```
4. **Run `pnpm -r test`.** Cited D-rows and file paths are checked by
   `packages/checks/test/citations.test.ts`, so an invented `(D103)` fails the build.

Watch for two things a compression pass tends to break, both found by review rather than tests:
keeping the footnote while deleting the fact ("Exported because…" is worthless if the reader
never learns what the thing is for), and orphaned comments left describing a declaration that
has since moved away from them.
