# Grace — the platform warns, waits, acts, and says what it did

> **How a destructive act reaches a repository.** A capability that wants a clock-triggered
> destructive act says so ONCE, with the words it wants used. The platform posts the warning on
> first sight, records it, refuses the act until the grace has run and no qualifying activity has
> happened, and posts the notice after the act lands. No capability keeps a clock of its own, reads
> back a reminder, or requests an outcome notice: it keeps the clocks that decide WHETHER an item is
> stale, and the words, and nothing else.

## 1. What a capability says

An intent whose operation is `clockTriggeredDestructive` MUST carry `grace`; any other class MUST
not (the screen refuses both mistakes):

```ts
readonly grace: {
    /** The full grace, in hours; at least MIN_GRACE_HOURS. The platform announces warnedAt + hours. */
    readonly hours: number;
    /** The comment identity's discriminator for the warning and the notice; "" by default (D145). */
    readonly topic?: string;
    /**
     * The words posted on first sight — the capability's voice, the date already rendered. The
     * body states five facts: what was observed and when, the exact act and its earliest time,
     * how the affected person cancels it, how a maintainer reverses it, and which setting
     * controls the timing. The four after the first are `cancelledBy`, `reversesWith` and the
     * dates the platform already holds; the capability's job is to say them in its own voice.
     */
    readonly warning: { readonly body: string };
    /** The words posted after the act lands. */
    readonly notice: { readonly body: string };
    /** What cancels the plan, in the warning's own words. */
    readonly cancelledBy: string;
    /** How a maintainer reverses the act. */
    readonly reversesWith: string;
    /** The newest qualifying activity by the affected person, if the facts carry one. */
    readonly activityAt: Date | null;
};
```

The occasion the intent is dated at is the clock's start — for `inactivity`, `idleSince` — so the
effect identity is stable across sweeps for as long as the clock runs, and a reset starts a new
identity. That is cycle scoping, and it costs no state: the next sweep after a `/working` mints a
different effect, and the old warning authorizes nothing because nothing asks under its identity.

## 2. What the engine does with it

For each destructive-class intent that passes the screens:

1. `externals.warningFor(effectId)` — the recorded warning, or `null`. The shell reads it from the
   store and re-mints it through `createDestructiveWarning`, the only constructor; a capability has
   no path to one.
2. **No warning:** approve a platform-authored effect — a `postManagedComment` of kind `warning`,
   body `grace.warning.body`, effect id the act's with the suffix `warning` and comment identity
   (capability, item, `warning`, the act's `topic`),
   and what the applier must record the moment the comment lands — the act's effect id, its
   request snapshot, the grace hours, `cancelledBy` and `reversesWith`. The act itself is not approved. In a record-only mode, the report says what
   would be warned.
3. **A warning:** `evaluateDestructive({ request, warning, qualifyingActivitySinceWarning: activityAt > warnedAt }, config, context, now)`.
   `graceRunning` is an `info` finding, not a problem — waiting is the design working. Any other
   refusal is reported as today. `apply` approves the act.

## 3. What the applier does

One act is one grace is one warning: an issue with two stale assignees earns two warnings, each
naming the assignee whose clock it is, because each release is its own act. Two warnings is two
COMMENTS only because the two acts name different topics — `inactivity` names the assignee's login
on an issue and the reap reason on a pull request. An act that leaves `topic` at `""` promises one
warning comment per item, rewritten in place by whichever act warns next (D145).

- A warning effect is one call: `postComment`. When it lands, the applier writes the warning
  record — `warnedAt = now`, `gracePeriodHours`, `earliestActionAt = warnedAt + hours`,
  `cancelledBy`, `reversesWith`, and the request snapshot — keyed by the ACT's effect id. A warning
  that never posted authorizes nothing, because nothing records it.
- An act effect is two calls: the act, then a `postComment` of kind `notice` with
  `grace.notice.body` under the act's own topic, so the notice stands beside the warning that
  preceded it. The plan runs in order and stops at the first
  refusal, so a notice never claims an act that did not land. Both calls journal as today.

## 4. Store

Schema v6 adds one table, `destructive_warning`: `effect_id` (primary key), `warned_at`,
`grace_hours`, `earliest_action_at`, `cancelled_by`, `reverses_with`, and the six snapshot columns
(`action_class`, `capability`, `cause_observed_at`, `cause`, `item`, `change`). Retention prunes rows
older than the longest grace any capability declares plus the standing retention window. Journal
rows are unchanged.

## 5. Declined

- **Platform-authored words** from `describeChange`: declined — the six designs write their own
  sentences in a coaching voice, and a template would flatten them. The platform owns WHEN, the
  capability owns WHAT.
- **Re-deriving the warning's date on every sweep**: declined — the record is the promise made to
  the person; the date they were told is the date that binds.
