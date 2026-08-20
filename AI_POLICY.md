# AI policy

Using AI to research, explain unfamiliar code, draft tests, or review your own diff is fine and
normal here — the maintainer does it. The tool is not the problem. Unverified output is.

## Three rules

1. **Human-led.** You direct the work, you make the decisions, and you can explain every line in
   review. If you cannot say why a line is there, it is not ready.
2. **Verified, not plausible.** AI output is a draft until you have checked it against this codebase.
   A confident answer and a correct one look identical.
3. **The bar does not move.** Accuracy, reliability, and safety are judged on the contribution, not
   the method. The suite does not care how code was produced.

## Not accepted

| | Why |
|---|---|
| PRs generated wholesale and submitted without review | Reviewing them costs more than writing them would have |
| Claims about this repository that were not checked against it | This repo is citation-heavy — a decision row, file path, or API that does not exist is worse than no citation |
| Documentation describing behaviour that does not exist | The most expensive kind of wrong: it reads correctly and nothing fails |
| Tests written to pass rather than to catch | A test that cannot fail is not a check |

## Disclosure

Routine assistance needs no announcement. Say so when an approach or a set of steps is **unverified**
— in an issue, in your PR description, or in a review comment. "I have not confirmed this" is a
useful sentence, and nobody is penalised for it.

## Why this repo is strict about it

Most rules here are enforced by a check rather than by review, so wrong code usually fails loudly.
Wrong *prose* does not: it reads correctly and nothing fails, which is why several invariants exist
purely to catch stale references. Confident, plausible, unverified text is exactly the failure mode
those checks were written for.
