# report/ — what happened, and who must act

Every decision core makes lands here. Four surfaces are views of this one list: the dry-run report,
the configuration report, the operator page, and the managed comment a capability leaves on an item.

The list is **flat on purpose**. Those four consumers group differently — by item, by capability, by
config path, by severity — and a shape that favours one makes the others awkward.

| File | The question it answers |
|---|---|
| [`finding.ts`](finding.ts) | What is a finding, what is it about, and what is a report? |
| [`convert.ts`](convert.ts) | How does what core already returns become one? |
| [`index.ts`](index.ts) | The barrel. |

Rendering is **not** here. A managed comment, a check-run annotation, an operator page — those are
the shell's business. This directory produces the record; something else decides how it looks.

## Severity is about what a maintainer must DO

Not about how bad something sounds. That distinction is the first one an operator surface has to
make, so it is made once, here.

- **`info`** — it happened, and it was normal.
- **`notice`** — nothing happened, and that was intended. A dry-run record, a disabled capability, a
  paused item.
- **`problem`** — a human has to act, or this keeps failing.

**A refusal is usually not a problem.** Most refusals are the system working correctly: a kill
switch is on, an item is paused, a human edited first. Reporting those as problems would bury the
handful that genuinely need attention — which is precisely the failure an operator surface exists to
prevent. [`convert.ts`](convert.ts) holds that judgement as **one table**, mapping every refusal
code to a severity, so the four consumers cannot drift into disagreeing about what counts as bad.

[`problems()`](finding.ts) filters to exactly that severity. It is the operator surface's whole job.

## Two things that stay machine-readable

`code` is what makes a report usable rather than merely readable: consumers group, count, link and
localise by it. `summary` is prose for a human and is **never asserted on** by tests — only its
presence is (D75).

`Subject` is a typed union rather than a string for the same reason. The configuration report
filters to `configuration`, the operator surface to `effect`, a managed comment to one `item` —
every consumer groups by it, so it has to be something a compiler can check.

## Who fills it in

A capability supplies its own **explanation** and no severity: it is not a capability's place to
decide how loud its own output is, and one that could mark itself `problem` could drown the ones
that are. The platform classifies; the capability explains.
