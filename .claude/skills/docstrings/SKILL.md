---
name: docstrings
description: Make a TypeScript file readable in this repo — what earns a docstring, how long it may be, where it goes, when a file should become two, and what order declarations belong in. Use when adding docstrings, reviewing comment density, compressing comments, reordering a file, or deciding how to split one.
---

# Docstrings for sdk-automations

## 1. The file header

**Always worth it, and it is the directory's documentation as much as the file's**: what this file
owns, what it does not, where the neighbours are — and for a barrel, the directory's rules and traps,
short. There are no READMEs below a package's `src/`; the header is where a newcomer meets them.

## 2. What earns a docstring

- **A public declaration** — every exported type, interface, const and function gets one line saying
  what it is. A name alone is ambiguous.
- **A private helper only when its NAME does not say what it does.** If `mintedTokenOf` needs a
  sentence, write it; `isRetriable` does not.
- **A constraint** — break it and something fails silently elsewhere (`satisfies` rather than a `:`
  annotation, or the derived unions collapse to `never`).
- **A non-obvious why** — the shape looks arbitrary and there is a forcing reason. One or two
  sentences: the reason, not the incident.

Never *history* — how we got here, what went wrong before — which belongs in `design/history/decisions.md`:
cite the row, `(D90)`, and stop. Never *restatement*: `enabled: boolean` does not need "whether it is
enabled". The deletion test is **remove the comment — what breaks?** If the answer is "nothing, we
would just know less about the past", delete it.

## 3. How long, and where

Identity is exactly one line. A constraint runs as long as the mechanism takes and no longer — naming
a rule without its mechanism only makes sense to someone who already knows. Orientation is enough
that a reader can **skip**, not enough to teach them everything.

**Write short declarative sentences, one idea each.** Three inferences welded with an em-dash become
two plain sentences; a sentence with more than one subordinate clause splits.

> ✗ `a field added to the shape and forgotten here is not — an interface cannot be enumerated at
> runtime, so that gap is the unknown-key rule wrongly rejecting a legitimate key`
>
> ✓ `Adding a field to RepositoryConfig does not add it here. Only the reverse is a compile error.`

**Explain at the top; keep the body scannable. A field comment must fit on one line — if it needs
more, it belongs in the type's docstring**, since an interface's value is seeing its shape at a
glance. Lifting is not pasting: apply the deletion test again after the move, and check the file
header first, which usually says half of it. **One fact, one place** — before writing a rationale,
check whether the enforcement site already carries it.

## 4. When a file becomes two

**A file answers one question. When it answers two, split — regardless of size. And do not create
files for questions nobody is asking yet.**

Size is a symptom, not the test. `config/sections.ts` is the largest file in its directory and the
most coherent in the repository: six functions of one shape answering "is each section well formed?".
The error types were 35 lines and had needed their own home all along, because the type lived in
`schema.ts` while its only constructor lived with the checkers (D103).

Coherence is judged the day the second concern arrives, which is cheap; pain is a lagging indicator.
Two sanity checks: if the file's one-line header needs the word "and", it is probably two files; if
two files would import each other constantly, they are probably one.

## 5. What order declarations go in

- **Dependencies read downward.** A declaration appears after everything it names. TypeScript hoists
  types, so this compiles either way — which is why it rots silently.
- **Runtime order is not a preference.** `cleanRecord` must precede `NO_CONFIG` because the constant
  calls it. Know which constraints are real and which are for the reader.
- **Inputs before outputs**, following the direction the data moves.
- **Sections match the file header, in the header's order.** A header listing three things while the
  file delivers a different three costs a reader a minute every time.

Prove a comment or reordering pass moved no code, and check the three places a top-level scan misses
— inside function bodies, on interface fields, and at the end of a file attached to nothing
(`grep -nE '^\s+/\*\*' <file>` and `tail -3 <file>`):

```bash
strip() { grep -vE '^\s*(\*|/\*\*|/\*|\*/|//)' "$1" | grep -vE '^\s*$'; }
diff <(strip "$ORIGINAL" | sort) <(strip "$REWRITTEN" | sort) && echo "same set, reordered"
```

Cited D-rows and file paths are checked by `packages/dev/checks/test/citations.test.ts`, so an
invented `(D103)` fails the build.
