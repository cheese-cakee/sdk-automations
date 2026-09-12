# The guard kit and the settings toolkit

> **The two kits every capability is written with.** Two small pieces of ordinary TypeScript that
> live in core beside the capability boundary. The first makes every `evaluate()` read as ordered
> guards the design doc's flowchart maps onto one-to-one; the second makes every `settings` file a
> declarative spec the same reader walks. Neither is a DSL and neither has an interpreter: the kits
> remove freedom of SHAPE, not steppability — a reader steps through the guards top to bottom, and
> each one is an `if` they can read where it stands. Anything that would need an interpreter is
> refused here.

## 1. The shape every capability takes

```ts
async evaluate(facts, view, platform) {
    const settings = readSettings(INACTIVITY_SETTINGS, view);            // §3
    if (!settings.ok) return unusable(settings.problems, platform, "inactivity"); // reported, never ignored

    /** Why this guard exists, travelling with the guard. */
    if (isPausedByProjection(facts.position)) return [];                // §2, in the flowchart's order
    if (facts.position.kind === "conflict") return [];
    if (!settings.value.issues.enabled) return [];
    return actOn(facts, settings.value, make);                          // the capability's own work
}
```

Three captions, always in this order: read the settings, pass the guards, act. The guards are the
flowchart's diamonds in evaluation order; the act is its final box. A capability with no settings
still reads an empty spec, so the shape does not vary. There is no loop: one record is one item
(`design/contracts/facts.md` §4), so a guard returns rather than continues.

Everything the guards do is ordinary control flow, which is the point: an early return NARROWS. A
guard that has ruled out a conflicted projection leaves the position branch behind it, and a guard
that has ruled out a disabled block leaves the enabled block — so nothing below re-reads what the
guard above already settled. The `clarity` skill's rules apply unchanged: a condition worth a name
gets one (`const notConflicted = …`), and one that reads plainly stays a plain `if`.

## 2. The three stops

A capability decides by STOPPING, and every stop it makes is one of three things. This is the rule
the ladder existed to enforce, kept without the ladder.

| The stop | How it is written | Who hears about it |
|---|---|---|
| **Silent** | `return []` / `continue` | nobody — the branch a flowchart writes as "nothing" |
| **An operator note** | `return skipped(platform, name, summary, ...detail)` | the operator surface, once, under the capability's name |
| **A comment to the person** | an ordinary managed-comment intent through the factory | the person, and the operator through the intent's own explanation |

Only the last writes. The three are separate because a skip that explained where the design says
nothing is a behaviour change, and the capabilities' own suites pin the difference. Six of the eight
guards in the three built capabilities are the silent branch.

The kit is one helper:

```ts
/** Stop and say why on the operator surface: one explanation, no intents. */
export function skipped<D extends TypedDeclaration>(
    platform: PlatformHandle<D>,
    capability: string,
    summary: string,
    ...detail: readonly string[]
): readonly never[];
```

It returns `[]`, typed `readonly never[]` so `return skipped(…)` is assignable wherever an
`evaluate` returns its own intent union. `unusable` (§3.2) is the settings caption's own stop and
is written through it.

Rules the kit fixes:

- **Guards are judgements, named for the question.** `notConflicted`, `stillOpen`, "has this
  repository mapped `awaitingTriage`?". A guard that needs data reads it where it stands.
- **Deny wins, and unknown is not a pass.** A resolver that could not answer is a `skipped`, never
  a pass (D51). Nothing can enforce this inside a guard, so the reviewer's test is: does every
  `!answer.ok` branch stop?
- **The order is the flowchart's, and that is a REVIEW rule.** Guards are written in the order the
  design doc reads its diamonds, so a reviewer can hold the two side by side. Advisory before
  destructive is a property of that order: the guard that would comment sits above any act that
  changes state. Nothing in the types enforces the order — the first promotion showed that a type
  which did cost only re-reads (D143).
- **No ladder type, and no combinator.** The ceiling is stated so it can be refused: a guard that
  wants to branch into two ladders has found two KINDS, and the capability branches on the record's
  kind into a file per ladder.

## 3. The settings toolkit — `capability/settings`

A settings file is a spec: a plain object whose values are field readers, built from a closed
vocabulary of constructors. `readSettings` walks it against the capability's view and returns the
typed settings or the list of problems. The vocabulary is what the six designs' config sections
need and nothing more:

| Constructor | Reads | Rule it carries |
|---|---|---|
| `flag({ default })` | a boolean | absent → default; a non-boolean is a problem |
| `days({ default? , inherits? })` | a non-negative integer of days | absent → the default, or the field it inherits from (the cascade, §3.1) |
| `count({ default })` | a non-negative integer | `0` may mean "uncapped" — the capability says so in prose, the reader does not |
| `text({ optional })` | a string | for guide links and references; never parsed |
| `meanings()` | a list of mapped label meanings | each entry must be one of `view.mapped.labels`; an unmapped meaning is a problem (a guard naming a meaning demands its mapping) |
| `commands()` | a list of mapped commands | the same rule against `view.mapped.commands` |
| `skills()` | a list of mapped skill tiers | the same rule against `view.mapped.skills`; the ladder ORDER is `SKILL_TIERS`, not the order a repository listed them |
| `texts()` | a list of free display text | checked for shape and nothing else — its entries are rendered into a sentence and never compared with a label, a command or a meaning |
| `principal({ optional })` | a principal name | must be one the document declares; absent when optional renders without the ping. Overloaded on `optional`, so a required principal reads `string` rather than `string \| null` |
| `section(fields)` | a plain group of fields with no consent of its own | absent → every field at its default; the station the group configures is switched by its own flags (`onOpen`, `approval`, a skill tier, a pillar) |
| `sections(fields, { keys? })` | a mapping of same-shaped groups | the open-keyed form (`subscriptions`, `roles`, `pillars`); keys are the repository's own, and `keys` names an OPEN mapping family every key must be found in (`subscriptions` are keyed by alert) |
| `closed(fields)` | a group of OPTIONAL members drawn from a closed vocabulary | `pillars`: a member the file did not state reads `null` rather than at its defaults, because "no `mergedPRs` pillar" and "a `mergedPRs` pillar of zero" are different requirements |
| `block(fields)` | an enabled-block | consent is `enabled: true` and nothing else; a block absent or `enabled: false` reads as `{ enabled: false }` and its other fields are NOT read — parked, not running |
| `blocks(fields)` | a mapping of same-shaped enabled-blocks | the per-item pattern (`checks`, `reapWhen`, `roles`); keys are the repository's own |
| `oneOf(values)` | a closed choice | `noticeOn: latestActivity \| trackingIssue`. No optional form, and inside `closed` it needs none: a member the file never stated is read by nobody |

**Every group constructor sweeps its own keys** (D4). `section`, `block`, and the two mappings of
them each report a key the spec does not name, at that key's own dotted path. D84's sweep reaches
the TOP of a settings block and stops, so a reader that walked its spec's keys and never looked at
the file's left a misspelt `mergedPRz:` counting nothing and saying nothing — the silent zero a
closed vocabulary exists to refuse. `block` counts `enabled` among its own keys, because consent is
not a field; a parked block sweeps nothing, having read nothing.

### 3.1 Cascades and relations

- **Most-specific-first.** `days({ inherits: "reapAfterDays" })` inside a block resolves reason →
  ladder → capability default: the reader looks at the field's own value, then the enclosing
  block's, then the capability's root field of that name. The spec names the chain by naming the
  field; the reader does the walking.
- **`MIN_GRACE_DAYS` relations.** `above(target, by)` is a relation a `days` field may declare:
  `reapAfterDays: days({ default: 21, above: ["remindAfterDays", MIN_GRACE_DAYS] })`. It is checked
  at every level where both resolve, after the cascade — the floor from `safety/destructive` is the
  one constant, imported, never restated.
- **Structural dependencies are structure.** `assignedIssues` nests inside `linkedIssues`; a nested
  block is unreadable when its parent is off, and anywhere else it is `unknownKey` at parse time
  already (D84).

### 3.2 Reported as unusable

`readSettings` returns `{ ok: true, value }` or `{ ok: false, problems }`, each problem a dotted
path under `capabilities.<name>.settings` and one sentence. `unusable(problems, platform, name)`
turns that into one `explain` — "Skipped: settings unusable — <path>: <message>" — and no
intent. This is the honest floor for R4: an unusable block is REPORTED on every delivery that meets
it and never silently ignored. The same spec, being data plus pure readers, is what the pull-request
configuration check runs at parse time when that build lands (config-schema §7); nothing here
presumes it.

### 3.3 What a spec is not

No conditional fields, no cross-field computation beyond the two relations above, no defaults that
depend on another field's value, no custom reader functions in a spec. One reader the designs name
is still absent: a SCALAR sibling of `skills()`, which is what checking advancement's `minTier`
against `mappings.skills` would need — `oneOf(SKILL_TIERS)` reads the tier name today and cannot ask
whether the repository mapped it. Where a design states a cross-field rule — advancement's `noticeIssue` required by
`noticeOn: trackingIssue` — the design's config is what moves, to a structural form (a group under
the choice that needs it), never the toolkit. A design that needs one of
those has found a config shape the six designs do not have, and the vocabulary grows by one
constructor in this file with its rule stated — never by a hook in a capability.

## 4. Declined, with triggers

- **A schema library** (zod and kin): declined — the vocabulary is nine constructors with rules the
  designs state in prose, and a library's error shape would replace `ConfigError`'s. Reopen never.
- **A `Verdict` ladder with a `climb` combinator**: BUILT (D138) and removed (D143). It was the one
  shape whose cost the first promotion could measure, and the measurement was against it: a verdict
  carries no subject, so every enabled block a ladder narrowed was read a second time after the
  climb purely for the type, and a question about a sub-subject ran as a one-rung ladder inside a
  loop (`design/constraints.md`, D143). Its discipline is §2's rules. Reopening it means
  reopening `proceed(value)` and `runRung` together, and the trigger is evidence of the same kind:
  a capability whose guards cannot be read against its flowchart without one.
