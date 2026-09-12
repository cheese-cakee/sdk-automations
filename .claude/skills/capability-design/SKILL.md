---
name: capability-design
description: Author or revise a capability design doc in design/guides/capabilities/ — the section structure, config conventions, guard patterns, and bot voice this repo's capability docs follow. Use when designing a new capability, rewriting an old-style candidate doc, or reviewing edits to one.
---

# Designing a capability for sdk-automations

Read the nearest exemplar first: the design docs beside their code in `packages/capabilities/src/`.
A new design starts in `design/guides/capabilities/` and moves into its capability's folder the day
that folder exists.

**Evidence before design:** start from what exists — the C++ and Python SDK bots and this repo's
audit (`design/audit/services.md`) — importing their guards and their scars, dropping their plumbing,
and making a difference between two SDKs two example configs of one schema rather than two features.

## The four sections

1. **What it does** — `# name — the one-sentence job` (lowercase, matching the config key), then 2–6
   bare lines: what it does, the acts-on / never-acts-on split, the one or two rules a reader must
   not miss. No history, no audit citations, no rationale prose.
2. **What the config looks like** — full `automations.yml` blocks, valid YAML, one per genuinely
   different policy. Rules prose only for what the examples cannot show.
3. **How it works** — one mermaid flowchart with the guards in evaluation order, a table where the
   behavior is tabular (per-check semantics, ladders), and real rendered examples of every comment
   the capability posts, in blockquotes. Voice: the coaching register — greet by name, name the
   reason, the fix and the date; never scold. Show fail and unknown states. No markdown links with
   placeholder targets (the link checker rejects them — write "the Signing Guide (configured link)").
4. **Verified by** — `Scenario | Proves`. This table IS the spec of the edge cases: counting rules,
   races, dedup, dry-run, kill switch, human sovereignty, and it is the test agenda by convention.
   When prose gets trimmed, its semantics must survive here.

Name every platform piece a scenario needs and does not have — catalogue entries, resolvers, sweep
drivers, mapping families — where it is needed; vocabulary the catalogue lacks is never silently
assumed.

## Config conventions

- **Explicit consent**: everything is opt-in; blocks carry `enabled: true`; "truthy is not consent".
  Never hang children off a scalar (`issues: true` + children is invalid YAML).
- **Meaning-sets and numbers**: guards are lists of mapped meanings (`claimableOnlyWhen`,
  `capIgnores`, `exemptWhen`) or numbers — never raw label strings. Check whether an existing meaning
  already expresses the rule before inventing config.
- **Cascade**: numbers resolve most-specific-first (reason → ladder → capability default), and each
  act threshold must exceed its remind threshold by `MIN_GRACE_DAYS` where warn-then-act applies.
- **Per-item blocks** when items may grow options — a second option kind is the trigger to convert
  booleans to blocks.
- **Mapping families**: label spellings under `mappings.labels`, command spellings under
  `mappings.commands`, skill tiers under `mappings.skills` — shared vocabulary never moves into a
  capability's settings. A guard naming a meaning demands its mapping (unmapped = invisible).
- Inline comments state constraints on the keys they constrain; deny wins when meaning-sets conflict;
  misconfiguration is "reported as unusable, not silently ignored".

## Design rules that recur

- Advisory before destructive; warn-then-act behind the destructive gate; unknown never reads as
  pass, "under the cap", or "no conflict" (D51).
- Capabilities compose through meanings and timeline events, never by naming a sibling or parsing a
  sibling's comment prose (P3).
- Native GitHub controls are never fought; roles are never read — the native UI is every team
  member's bypass.
- Commit text and titles are attacker-controlled: escaped, mentions broken.
- Repo-local counting; org-wide reads are the parked ceiling question (D57).
- Managed comments: one per identity, updated in place; refusals cycle-scoped so repeats don't
  amplify.

**Finishing:** run `pnpm test` in `packages/dev/checks` — citations, links and doc drift gate the
docs — and give a direction change a register row.
