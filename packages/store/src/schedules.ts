/**
 * What a scheduled row is, before and after a firing is claimed.
 *
 * Vocabulary only. `store.ts` owns the transitions these rows move
 * through — declaration, claim, redrive, completion. `deliveries.ts` and
 * `effects.ts` are the sibling vocabularies.
 */

/** Clock-triggered work before or after ownership is attached. */
export interface ScheduleRow {
    readonly scheduleId: string;
    readonly dueAt: string;
    readonly effect: string;
}

/** A schedule row whose firing has been claimed. */
export interface ClaimedScheduleRow extends ScheduleRow {
    /** Unique to this firing; required to complete it. */
    readonly claimToken: string;
}
