/**
 * What a ladder IS, and who is still on one — `design.md`'s "How it works", as
 * pure judgements over this capability's own settings.
 *
 * The clocks themselves are core's now (`facts.ts`), because what a clock reads
 * is true of any capability's record. What is left here is the part that reads
 * INACTIVITY's settings: the pair of thresholds a ladder is, the gap between
 * its rungs, the date a warning names, and the stop both ladders share — which
 * needs this repository's own `exemptBlocked` answer and so cannot live in core.
 *
 * There is no "is the act due" here. A ladder emits its act as soon as the
 * clock passes `remindAfterDays`, and the PLATFORM warns, waits out the grace
 * and refuses the act until it has run (grace.md §2).
 */

import { DAY_MS, isConflicted, isOpen, isPaused } from "@hiero-hackers/automation-core";
import type { InactivitySettings } from "./context.js";
import type { InactivityFacts } from "./declaration.js";

/** A resolved pair of thresholds — a ladder's, or one pull-request reason's. */
export interface Ladder {
    readonly remindAfterDays: number;
    readonly reapAfterDays: number;
}

/**
 * The gap between the two rungs — the grace the platform holds an act for.
 *
 * The capability keeps the two clocks and hands the platform their difference;
 * it keeps no clock of its own between them, because the platform records when
 * it warned and that record is what the wait is measured from (grace.md §3).
 * The settings spec already holds `reapAfterDays` above `remindAfterDays` by
 * `MIN_GRACE_DAYS`, so this is at least the floor by construction.
 */
export function graceDaysOf(ladder: Ladder): number {
    return ladder.reapAfterDays - ladder.remindAfterDays;
}

/**
 * The date a warning names: the observation plus the grace it announces.
 *
 * Not the clock's own reap date. The warning is posted on first sight of a
 * stale item, so the promise it makes runs from THAT moment — and a first
 * sweep after a long gap would otherwise tell every stale item a date behind
 * it. The platform holds the act for exactly this long, from the day the
 * comment lands, so the sentence and the gate agree by construction.
 */
export function deadlineOf(ladder: Ladder, observedAt: Date): Date {
    return new Date(observedAt.getTime() + graceDaysOf(ladder) * DAY_MS);
}

/**
 * The three stops both ladders share, in the flowcharts' order: a paused item's
 * clocks all stop and the exemption is the repository's; a conflicted item has
 * no position to judge; and a closed issue and a merged pull request have both
 * left. Each question is core's, and the settings that decide whether the first
 * one is asked at all are this capability's — which is the whole of what is
 * left here.
 */
export function stillOnTheLadder(facts: InactivityFacts, settings: InactivitySettings): boolean {
    if (settings.exemptBlocked && isPaused(facts)) return false;
    if (isConflicted(facts)) return false;
    return isOpen(facts);
}
