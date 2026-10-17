/**
 * The warnings an item carries, read back from its comments: a composition with no store
 * between runs recovers the act's authority from the marker the warning comment holds. Only the
 * App's own comments count, the first record for an effect binds, a comment GitHub did not date
 * authorises nothing, and a rewritten warning is dated at its rewrite (grace.md §3).
 */

import {
    parseManagedMarker,
    type CommentFact,
    type ItemRef,
    type ReadBack,
    type RepositoryRef,
} from "@hiero-hackers/automation-core";
import type { Ledger, StoredWarning } from "../../store/index.js";

const HOUR_MS = 60 * 60 * 1000;

export interface HydrateOptions {
    readonly ledger: Ledger;
    readonly reader: ReadBack;
    readonly repository: RepositoryRef;
    readonly item: ItemRef;
    /** The configuration revision the rows carry. */
    readonly revision: string;
}

/** An ISO instant GitHub dated, or `null` where it did not. */
function instantOf(value: string | undefined): string | null {
    if (value === undefined) return null;
    const time = Date.parse(value);
    return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/** When the warning was last written: a rewrite in place restarts the grace, never shortens it. */
function warnedInstantOf(comment: CommentFact): string | null {
    const created = instantOf(comment.createdAt);
    const updated = instantOf(comment.updatedAt);
    if (created === null) return null;
    return updated !== null && updated > created ? updated : created;
}

/** Record every warning the item's comments carry; answers how many rows were offered. */
export async function hydrateWarnings(options: HydrateOptions): Promise<number> {
    const { ledger, reader, repository, item, revision } = options;
    const read = await reader.comments(item);
    if (!read.ok) return 0;
    let offered = 0;
    for (const comment of read.value) {
        if (!comment.authoredByApp) continue;
        const reading = parseManagedMarker(comment.body);
        if (!("recognized" in reading) || reading.recognized.record === undefined) continue;
        const warnedAt = warnedInstantOf(comment);
        if (warnedAt === null) continue;
        const { record } = reading.recognized;
        const snapshot: Omit<StoredWarning, "effectId"> = {
            warnedAt,
            gracePeriodHours: record.gracePeriodHours,
            earliestActionAt: new Date(
                Date.parse(warnedAt) + record.gracePeriodHours * HOUR_MS,
            ).toISOString(),
            cancelledBy: record.cancelledBy,
            reversesWith: record.reversesWith,
            actionClass: record.actionClass,
            capability: record.capability,
            causeObservedAt: record.causeObservedAt,
            cause: record.cause,
            item: record.item,
            change: record.change,
        };
        ledger.record({
            effectId: record.effectId,
            seq: 0,
            kind: "warned",
            at: warnedAt,
            revision,
            capability: record.capability,
            repository,
            item,
            verb: null,
            login: null,
            code: null,
            detail: null,
            payload: JSON.stringify(snapshot),
        });
        offered += 1;
    }
    return offered;
}
