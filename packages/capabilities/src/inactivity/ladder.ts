/**
 * What a ladder is, and who is still on one — pure judgements over this
 * capability's settings. The platform, not a ladder, holds the grace.
 */

import { HOUR_MS, isConflicted, isOpen, isPaused } from "@hiero-hackers/automation-core";
import type { InactivitySettings } from "./context.js";
import type { InactivityFacts } from "./declaration.js";

/** A resolved level, in hours. `reapAfter` is `null` where it never acts. */
export interface Ladder {
    readonly remindAfter: number;
    readonly reapAfter: number | null;
}

/** A level that reaps — what every grace computation below needs. */
export interface Reaping extends Ladder {
    readonly reapAfter: number;
}

/** One acting level's clocks, read out of the block a repository consented to. */
export function ladderOf(level: {
    readonly remindAfter: number;
    readonly reap: { readonly enabled: false } | { readonly enabled: true; readonly after: number };
}): Ladder {
    return {
        remindAfter: level.remindAfter,
        reapAfter: level.reap.enabled ? level.reap.after : null,
    };
}

export function reaps(ladder: Ladder): ladder is Reaping {
    return ladder.reapAfter !== null;
}

/** The gap between the two rungs — the grace the platform holds an act for. */
export function graceHoursOf(ladder: Reaping): number {
    return ladder.reapAfter - ladder.remindAfter;
}

/** The date a warning names: the observation plus the grace it announces. */
export function deadlineOf(ladder: Reaping, observedAt: Date): Date {
    return new Date(observedAt.getTime() + graceHoursOf(ladder) * HOUR_MS);
}

/** The three stops both ladders share, in order: paused, conflicted, closed. */
export function stillOnTheLadder(facts: InactivityFacts, settings: InactivitySettings): boolean {
    if (settings.exemptBlocked && isPaused(facts)) return false;
    if (isConflicted(facts)) return false;
    return isOpen(facts);
}
