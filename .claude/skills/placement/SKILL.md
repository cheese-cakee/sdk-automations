---
name: placement
description: Decide where code lives in this repo — how to split a directory into files, what to name them, which directory a thing belongs in, when a directory earns a subdirectory or graduates to a package, and when to leave structure alone. Use when reorganising, adding a module, auditing a directory, or asking "where should this go".
---

# Where code lives in sdk-automations

Boundaries between files and directories. For what goes *inside* one file, use `docstrings`.

## The naming rule

**Name a directory for the question a maintainer arrives with, not for a technical kind.** `engine/`
answers "what does the platform DO with a delivery?"; `safety/` answers "may this write happen?".
There is no `types/`, `utils/`, `helpers/` or `lib/` — naming by kind forces you to already know the
answer in order to find it. The same test applies to a file's name, and two names in one directory
must not mean different things (D103).

A directory documents itself in its `index.ts` header. There are no READMEs below a package root.

## Auditing a directory

1. **List the questions the directory answers.** Not the files. The questions.
2. **Map each file to the questions it answers.** A file answering two is a split candidate; a
   question answered across three files is a merge candidate.
3. **Draw the import direction** — grep each file's sibling imports — and check it is acyclic with
   one root. Then check what the barrel exposes: `export *` leaks internals silently.

## Which directory something belongs in

- **Follow the question, not the noun.** A thing belongs where its *question* is asked, often not
  where its subject matter sits (D55).
- **Every arrow points one way, and one directory is the root.** In `core/`, `config/` imports
  nothing. A new import into the root means something is in the wrong place.
- **A type-only cycle is still a cycle** (D91, D92).
- **A bridge lives at one end.** When a table's keys come from one concern and its values from
  another, pick an end, state why, and stop.

## Depth and graduation

- **A target earns a subdirectory only when it needs a second file** (D89).
- **A directory graduates to a package when it has external consumers and almost no internal ones**
  (D93). Write the trigger down when you notice it approaching.
- **Tests follow their reach, not their subject** (D85): a test reading another package or the
  repository root belongs in `checks/`; one that can kill a mutant in a package's `src/` stays there.

## When to leave structure alone

- **Structure follows substance only as far as substance leads.** When a reorganisation stops
  paying, stop and write down what you declined and why.
- **Do not restructure for a future you are guessing at.** A boundary in the wrong place is worse
  than no boundary, because you then import across it forever.

## Executing a move safely

- **`git mv`**, so history follows the file. When staging is not yours, a plain `mv` leaves the same
  tree — git reads the rename off the content when the delete and the add are staged later.
- **Nothing added or lost** — the sorted, comment-stripped declarations must match:
  ```bash
  strip() { grep -vE '^\s*(\*|/\*\*|/\*|\*/|//)' "$1" | grep -vE '^\s*$'; }
  diff <(strip "$ORIGINAL" | sort) <(strip "$REWRITTEN" | sort) && echo "same set"
  ```
- **`.gitignore` rules move in the same breath as the directory** (D95).
- **`pnpm -r test`** — the citation invariant fails on any document naming a file that has moved.
- **The register is two files, both out of the citation corpus**: `design/constraints.md` for the
  rows that still bind and `design/history/decisions.md` for every row ever written. A row keeps
  naming the tree as it was, and no move edits one.
