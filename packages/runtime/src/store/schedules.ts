/** What a scheduled row is, before and after a firing is claimed. Vocabulary only. */

export interface ScheduleRow {
    readonly scheduleId: string;
    readonly dueAt: string;
    readonly effect: string;
}

export interface ClaimedScheduleRow extends ScheduleRow {
    /** Unique to this firing; required to complete it. */
    readonly claimToken: string;
    /** The item number the last firing stopped reading at; null starts the list again (D170). */
    readonly resumeAfter: number | null;
}

/** One row as an operator reads it: where it stands, and the claim on it (D168). */
export interface ScheduleStanding extends ScheduleRow {
    readonly status: "pending" | "running" | "done";
    /** Held while a firing runs; cleared when the row is completed or re-armed. */
    readonly claimedAt: string | null;
}
