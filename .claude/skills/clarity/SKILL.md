---
name: clarity
description: How a function body reads in this repo — the no-throw pipeline shape, what earns a named step, how deep to distrust input, factory versus class, and the house vocabulary. Use when writing or reviewing function bodies, when code feels dense or hard to narrate, or when deciding whether to extract a helper or how to shape a stateful component.
---

# How a function body reads in sdk-automations

`docstrings` governs comments and declaration order; `placement` governs files and directories. This
skill governs the space between: the body of one function.

## The narration test

**A function is readable when each visual block can be captioned in one sentence, and the captions in
order tell the function's story.** Read the body block by block and say what each does: "send the
request", "read the body", "classify the failure", "parse the token or refuse". A block you cannot
caption needs a name — extract it. A function whose captions do not form a story is two functions.

This replaces line counts: a 60-line body of four clean blocks reads fine, a 20-line body of
interleaved concerns does not.

## The house pipeline shape

- **Nothing throws across a boundary.** Every outcome is a typed value with an `ok` discriminant; the
  caller branches, never catches. `http.ts`'s `request()` is the model.
- **Early returns, straight down.** Each stage either produces the next stage's input or returns a
  typed failure. No accumulator flags, no nesting past two levels, no cleverness that reorders
  reading order away from execution order.
- **The try/catch ceremony is deliberate — do not compress it.** One `try` per fallible seam, each
  mapping to a named failure, is the contract that callers never see an exception. A generic
  `attempt()` combinator was declined: it trades visible control flow for a higher-order puzzle. Keep
  the ceremony; NAME its stages instead.

## What earns extraction

Extract when the piece answers a question you can name — never to shrink a line count:

- A **judgement**: `isRetriable`, `sameSecond` — an inline condition past ~3 clauses or ~10 lines is
  a predicate begging for a name.
- A **stage** of the pipeline: `prepareHeaders` (headers in, ready-to-send out), `mintedTokenOf`
  (body in, token-or-null out). Pure where possible, returning a value the narration can name.
- A **parser of untrusted bytes**.

Do NOT extract plumbing that has no question — passing six closure variables to a helper just moves
text — and do not extract below the narratable-block level.

## Factories or classes

**A factory for a narrow seam** — a small surface that is injected and scripted (the token source,
the HTTP client, the processor): dependencies destructured once at the top, the returned interface
the whole public story, internals sealed. **A class for a stateful engine room** — `Store`, a live
connection with method families; core's `EngineHandle`, a per-evaluation accumulator. The tiebreaker
is the state inventory: one latch behind a two-method surface is a seam; a connection with growing
method families is an engine room. When the complaint is NOISE, reach for the proportionate fix
(destructure once) before reaching for a rewrite.

## Distrust in proportion

- **Bytes from the network** (response bodies, webhook payloads): full defensive reads. A
  `field(value, name)` helper that cannot throw, and parse functions returning `T | null` (or
  `T | null | "unparsable"` when the difference matters) — never functions that throw on bad shape.
- **Injected seams** (a `TokenSource`, a clock): contain throws and check the contract once, at the
  seam, mapping to a named failure.
- **Values that already crossed a paid-for boundary**: trust them. Distrust was purchased once, at
  the seam; paying twice is the over-engineering this repo's reviews flag.

## The vocabulary key

| Word | Means |
|---|---|
| **weather** | an external failure worth a retry (`transient`) — the network's mood, not a defect |
| **seam** | an injected dependency; the composition root fills it, tests script it |
| **judgement** | a pure local decision function, no I/O |
| **contained** | caught and converted to a typed outcome; the caller never sees the throw |
| **bounds** | the chosen numeric limits, declared at the top of the file, with reasons |

When a body stops narrating, fix it the same day — the reader who complains is the evidence it
already hurts.
