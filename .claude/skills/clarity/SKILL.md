---
name: clarity
description: How a function body reads in this repo — the no-throw pipeline shape, what earns a named step, how deep to distrust input, and the house vocabulary. Use when writing or reviewing function bodies, when code feels dense or hard to narrate, or when deciding whether to extract a helper.
---

# How a function body reads in sdk-automations

`docstrings` governs comments and declaration order; `placement` governs files and directories.
This skill governs the space between: the body of one function. It exists because the same
complaint — "this is hard to understand" — landed three times on the same code shape before
anyone wrote the shape down.

## The narration test

**A function is readable when each visual block can be captioned in one sentence, and the
captions in order tell the function's story.** Read the body block by block and say aloud what
each does: "send the request", "read the body", "classify the failure", "parse the token or
refuse". A block you cannot caption is a block that needs a name — extract it. A function whose
captions do not form a story is two functions.

This test replaces line counts. A 60-line body of four clean blocks reads fine; a 20-line body
of interleaved concerns does not.

## The house pipeline shape

Boundary code here follows one shape, on purpose:

- **Nothing throws across a boundary.** Every outcome is a typed value with an `ok`
  discriminant; the caller branches, never catches. `http.ts`'s `request()` and `token.ts`'s
  `current()` are the models.
- **Early returns, straight down.** Each stage either produces the next stage's input or
  returns a typed failure. No accumulator flags, no nesting past two levels, no cleverness
  that reorders reading order away from execution order.
- **The try/catch ceremony is deliberate — do not compress it.** One `try` per fallible seam,
  each mapping to a named failure, is the contract that callers never see an exception. A
  generic `attempt()` combinator was considered and declined: it trades visible control flow
  for a higher-order puzzle. Keep the ceremony; NAME its stages instead.

## What earns extraction

Extract when the piece answers a question you can name — never to shrink a line count:

- A **judgement**: `isWellFormedTokenOutcome`, `isRetriable`, `sameSecond`. If an inline
  condition needs more than ~3 clauses or ~10 lines, it is a predicate begging for a name.
- A **stage** of the pipeline: `prepareHeaders` (headers in, ready-to-send out),
  `mintedTokenOf` (body in, token-or-null out), `humanChangeAt` in `externals.ts` (entry in,
  date-or-verdict out). A stage function is pure where possible and returns a value the
  narration can name.
- A **parser of untrusted bytes**: see below.

Do NOT extract plumbing that has no question — passing six closure variables to a helper just
moves text. And do not extract below the narratable-block level: a pipeline should stay flat,
top to bottom, in one place.

## Distrust in proportion

Validation depth follows the boundary, not habit:

- **Bytes from the network** (response bodies, webhook payloads): full defensive reads. Use a
  `field(value, name)` helper that cannot throw, and parse functions that return
  `T | null` (or `T | null | "unparsable"` when the difference matters) — never functions
  that throw on bad shape.
- **Injected seams** (a `TokenSource`, a clock, a timeout factory): contain throws and check
  the contract once, at the seam, mapping to a named `brokenSeam`-style failure.
- **Values that already crossed a paid-for boundary**: trust them. An operation consuming
  `GitHubOutcome` does not re-validate it; a consumer of the token source's outcome inside
  the same package does not re-check its shape. Distrust was purchased once, at the seam —
  paying twice is the over-engineering this repo's reviews flag.

## The vocabulary key

These words are load-bearing in comments here; use them the same way, and expect them:

| Word | Means |
|---|---|
| **weather** | an external failure worth a retry (`transient`) — the network's mood, not a defect |
| **seam** | an injected dependency; the composition root fills it, tests script it |
| **judgement** | a pure local decision function, no I/O |
| **contained** | caught and converted to a typed outcome; the caller never sees the throw |
| **bounds** | the chosen numeric limits, declared at the top of the file, with reasons |

## The worked example

The mint call (`githubMintInstallationToken`) originally ended in six inline defensive checks —
parse, shape, two fields, a date, permissions — and drew exactly the "hard to understand"
complaint this skill exists for. The fix was not fewer checks (every one guards something) but
one name: `mintedTokenOf(body)` — "the minted token a 2xx body carries, or `null`". The
closure now narrates in four captions: send it, read it, classify a refusal, parse the token
or refuse. Same rigor, one sentence per block.

When a body stops narrating, that is the moment to fix it — same day, not "when it hurts";
the reader who complains is the evidence it already hurts.
