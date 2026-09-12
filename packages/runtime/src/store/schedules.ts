/** What a scheduled row is, before and after a firing is claimed. Vocabulary only. */

export interface ScheduleRow {
    readonly scheduleId: string;
    readonly dueAt: string;
    readonly effect: string;
}

export interface ClaimedScheduleRow extends ScheduleRow {
    /** Unique to this firing; required to complete it. */
    readonly claimToken: string;
}
