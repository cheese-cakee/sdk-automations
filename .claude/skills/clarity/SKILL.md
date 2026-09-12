---
name: clarity
description: How a function body reads in this repo — the no-throw pipeline shape, what earns a named step, how deep to distrust input, factory versus class, and the house vocabulary. Use when writing or reviewing function bodies, when code feels dense or hard to narrate, or when deciding whether to extract a helper or how to shape a stateful component.
---

# How a function body reads in sdk-automations

`docstrings` governs comments and declaration order; `placement` governs files and directories. This
skill governs the body of one function.

## The narration test

**A function is readable when each visual block can be captioned in one sentence, and the captions
in order tell the function's story.** A block you cannot caption needs a name — extract it. A
function whose captions do not form a story is two functions. This replaces line counts.

## The house pipeline shape

- **Nothing throws across a boundary.** Every outcome is a typed value with an `ok` discriminant;
  the caller branches, never catches. `http.ts`'s `request()` is the model.
- **Early returns, straight down.** Each stage either produces the next stage's input or returns a
  typed failure. No accumulator flags, no nesting past two levels.
- **The try/catch ceremony is deliberate — do not compress it.** One `try` per fallible seam, each
  mapping to a named failure. A generic `attempt()` combinator is declined. NAME the stages instead.

## What earns extraction

Extract when the piece answers a question you can name — never to shrink a line count:

- A **judgement**: an inline condition past ~3 clauses or ~10 lines is a predicate begging for a name.
- A **stage** of the pipeline: headers in, ready-to-send out. Pure where possible.
- A **parser of untrusted bytes**.

Do NOT extract plumbing that has no question, and do not extract below the narratable-block level.

## Factories or classes

**A factory for a narrow seam** — a small surface that is injected and scripted: dependencies
destructured once at the top, the returned interface the whole public story, internals sealed.
**A class for a stateful engine room** — a live connection with method families, a per-evaluation
accumulator. The tiebreaker is the state inventory: one latch behind a two-method surface is a
seam; a connection with growing method families is an engine room. When the complaint is NOISE,
destructure once before reaching for a rewrite.

## Distrust in proportion

- **Bytes from the network** (response bodies, webhook payloads): full defensive reads. A
  `field(value, name)` helper that cannot throw, and parse functions returning `T | null` (or
  `T | null | "unparsable"` when the difference matters) — never functions that throw on bad shape.
- **Injected seams** (a `TokenSource`, a clock): contain throws and check the contract once, at the
  seam, mapping to a named failure.
- **Values that already crossed a paid-for boundary**: trust them. Paying twice is over-engineering.

## The vocabulary key

| Word | Means |
|---|---|
| **weather** | an external failure worth a retry (`transient`) |
| **seam** | an injected dependency; the composition root fills it, tests script it |
| **judgement** | a pure local decision function, no I/O |
| **contained** | caught and converted to a typed outcome; the caller never sees the throw |
| **bounds** | the chosen numeric limits, declared at the top of the file |
