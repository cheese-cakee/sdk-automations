---
name: placement
description: Decide where code lives in this repo — how to split a directory into files, what to name them, which directory a thing belongs in, when a directory earns a subdirectory or graduates to a package, and when to leave structure alone. Use when reorganising, adding a module, auditing a directory, or asking "where should this go".
---

# Where code lives in sdk-automations

For deciding boundaries between files and directories. For what goes *inside* one file — comments,
declaration order, when a file becomes two — use the `docstrings` skill; §4 there is the file-level
half of this one.

## The naming rule this repo runs on

**Name a directory for the question a maintainer arrives with, not for a technical kind.**

`engine/` answers "what does the platform DO with a delivery?". `safety/` answers "may this write
happen?". `config/` answers "what did this repository ask for?". There is no `types/`, no `utils/`,
no `helpers/`, no `lib/` — **naming by kind forces you to already know the answer in order to find
it**, which is exactly backwards for a newcomer.

The same test applies one level down: a file's name should answer *which* question it takes. And
two names in one directory must not mean different things. Before D103 the label lookup was
named after the config section it had nothing to do with, while the reader for that very section
lived elsewhere under almost the same name. It cost real confusion.

(This paragraph had to describe those two files without naming them: the bare-filename check
rejects any `.ts` that no longer exists. That constraint is real and is listed under *Executing a
move safely* below.)

## Auditing a directory — the method that works

1. **List the questions the directory answers.** Not the files. The questions.
2. **Map each file to the questions it answers.** A file answering two is a split candidate; a
   question answered across three files is a merge candidate.
3. **Draw the import direction** and check it is acyclic with one root:
   ```bash
   for f in <dir>/*.ts; do n=$(basename "$f" .ts); \
     d=$(grep -oE 'from "\./[a-z]+\.js"' "$f" | sed 's|from "\./||;s|\.js"||' | sort -u | tr '\n' ' '); \
     [ -n "$d" ] && echo "$n → $d"; done
   ```
4. **Check what the barrel exposes.** `export *` leaks internals silently — the shape sections use
   to talk to each other is not part of the package's public surface.

`config/` was audited exactly this way in D103: seven questions, six files, one file answering three
of them.

## Which directory something belongs in

**Follow the question, not the noun.** A thing belongs where its *question* is asked, which is often
not where its subject matter sits. The reverse label lookup lives in `config/` rather than the
engine, because the validator's collision check and the lookup must fold strings identically (D55) —
same question, one home.

**Every arrow points one way, and one directory is the root.** In `core/`, `config/` imports nothing.
Know which yours is and keep it that way; a new import into the root is the signal you have put
something in the wrong place.

**A type-only cycle is still a cycle.** D91 priced one, D92 removed it by moving the normalizer into
`engine/`. "It is erased at runtime" is not a defence — it is still two directories that cannot be
understood separately.

**A bridge lives at one end.** When a table's keys come from one concern and its values from
another — `MEANING_FACTS` is keyed by a config concept and valued by a workflow one — pick an end,
state why, and stop. Splitting it puts the key and the value in different packages.

## Depth and graduation

**A target earns a subdirectory only when it needs a second file** (D89). This is a rule against
premature nesting, and it does not govern splitting files — that is the coherence test in
`docstrings` §4.

**A directory graduates to its own package when it has external consumers and almost no internal
ones** (D93). Write the trigger down when you notice it approaching, so the move happens on evidence
rather than on feel.

**Tests follow their reach, not their subject** (D85): a test that reads another package or the
repository root belongs in `checks/`; a test that can kill a mutant in a package's `src/` stays in
that package. Getting this wrong once meant core's suite failed when a markdown file changed, and a
module scoring 0.00% mutation because the fixtures sat outside the package Stryker sandboxes.

## When to leave structure alone

The most useful rule here, and the easiest to forget while holding a diagram.

**Structure follows substance only as far as substance leads.** D92's phase 5 planned a four-story
re-layering of `core/` and executed the subset that was real, then declined the rest with reasons:
moving `project.ts` would have minted a genuine cycle, the screens are entangled with the intent
types in a way that makes extraction surgery rather than a rename, and `safety/` already *was* the
rules story under its own name. The four stories exist as **the reading of core**, recorded in the
README, not as directory churn chasing a picture.

So: when a reorganisation stops paying, stop, and write down what you declined and why. A rejected
move with a recorded reason is worth more than a completed one nobody can question.

**Do not restructure for a future you are guessing at.** A boundary in the wrong place is worse than
no boundary, because you then import across it forever.

## Executing a move safely

- **`git mv`**, so history follows the file.
- **Nothing added or lost** — for a pure reorganisation, the sorted declarations must match:
  ```bash
  strip() { grep -vE '^\s*(\*|/\*\*|/\*|\*/|//)' "$1" | grep -vE '^\s*$'; }
  diff <(strip "$ORIGINAL" | sort) <(strip "$REWRITTEN" | sort) && echo "same set"
  ```
- **`.gitignore` rules move in the same breath as the directory.** D95 records the minutes during
  which credentials were stageable because the ignore rules still named the old paths.
- **`pnpm -r test`** — the citation invariant fails on any document naming a file that has moved,
  which is how the last three reorganisations found their stale references.
- **The register is history**: a row describing a rename cannot NAME the old file, because the
  bare-filename check rejects a `.ts` that no longer exists. Describe it instead.

## Record it

A move of any size gets a register row: what moved, what did not and why, the cost you accepted,
and the trigger that would reopen it. D95, D97 and D103 are the models — each one names at least
one thing it deliberately did not do.
