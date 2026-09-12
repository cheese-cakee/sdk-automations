---
name: docstrings
description: Make a TypeScript file readable in this repo — what earns a docstring, how long it may be, where it goes, when a file should become two, and what order declarations belong in. Use when adding docstrings, reviewing comment density, compressing comments, reordering a file, or deciding how to split one.
---

# Docstrings for sdk-automations

The tree is bare bones. `packages/dev/checks/test/bare-bones.test.ts` enforces every ceiling below.

## The ceilings

| Thing | Ceiling |
|---|---|
| File header | ≤ 6 lines of text: what the file is, one sentence; what it is not, at most one; nothing else |
| Declaration docstring (function, type, const) | ≤ 3 lines: what it does; one constraint if one exists |
| Field or property comment | 1 line |
| Inline `//` comment | 1 line, and only where the code cannot say it |
| Comment share of a file | ≤ 25% of non-blank lines |

## The rules

1. **A public declaration gets one line saying what it is.** A private helper gets one only when its
   NAME does not say what it does: `mintedTokenOf` may need a sentence, `isRetriable` does not.
2. **A constraint earns a line when breaking it fails silently elsewhere** — `satisfies` rather than
   a `:` annotation, or the derived unions collapse to `never`.
3. **No narrative.** No history, no "used to", no "before this change", no dates, no session or
   packet names. History is git's and the register's: `(D103)` is the whole of what a comment may
   say about why.
4. **No restatement.** `enabled: boolean` does not need "whether it is enabled". The deletion test
   is **remove the comment — what breaks?** If the answer is "nothing", delete it.
5. **One fact, one place.** Before writing a rationale, check whether the enforcement site already
   carries it. A field comment that needs a second line belongs in the type's docstring, or nowhere.

Write short declarative sentences, one idea each. A sentence with more than one subordinate clause
splits.

> ✗ `a field added to the shape and forgotten here is not — an interface cannot be enumerated at
> runtime, so that gap is the unknown-key rule wrongly rejecting a legitimate key`
>
> ✓ `Adding a field to RepositoryConfig does not add it here. Only the reverse is a compile error.`

## When a file becomes two

**A file answers one question. When it answers two, split — regardless of size. Do not create files
for questions nobody is asking yet.** Two checks: if the header needs the word "and", it is probably
two files; if the two halves would import each other constantly, they are one.

## What order declarations go in

- **Dependencies read downward.** A declaration appears after everything it names. TypeScript hoists
  types, so this compiles either way — which is why it rots silently.
- **Runtime order is not a preference.** `cleanRecord` must precede `NO_CONFIG` because the constant
  calls it.
- **Inputs before outputs.**
- **Sections match the file header, in the header's order.**

Prove a comment or reordering pass moved no code, and check the three places a top-level scan misses
— inside function bodies, on interface fields, and at the end of a file attached to nothing
(`grep -nE '^\s+/\*\*' <file>` and `tail -3 <file>`):

```bash
strip() { grep -vE '^\s*(\*|/\*\*|/\*|\*/|//)' "$1" | grep -vE '^\s*$'; }
diff <(strip "$ORIGINAL" | sort) <(strip "$REWRITTEN" | sort) && echo "same set, reordered"
```

Cited D-rows and file paths are checked by `packages/dev/checks/test/citations.test.ts`, so an
invented `(D103)` fails the build.
