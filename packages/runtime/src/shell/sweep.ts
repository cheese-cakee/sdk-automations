/**
 * The sweep driver: a due schedule row becomes one fact record per open item, and
 * each becomes one decision (sweep.md §2). This lane exists because nobody told us.
 */

import type {
    EngineCapability,
    IssueFacts,
    ItemRef,
    PullRequestFacts,
    RepositoryConfig,
    Unread,
} from "@hiero-hackers/automation-core";
import type { ClaimedScheduleRow, Store } from "../store/index.js";
import { detailOf, type Log } from "./log.js";
import type { FactRecordInput, ShellRecord } from "./processor.js";
import { SWEEP_EFFECT, sweptItemId, wantsSweeping } from "./schedule.js";

// ─── The seams ───────────────────────────────────────────────────────

/**
 * One open item as the list carries it — the adapter's `OpenItem`, restated.
 * Restated rather than imported: only `main.ts` may name the adapter, and that is where the two shapes are checked against each other.
 */
export interface SweptItem {
    readonly item: ItemRef;
    readonly author: string;
    readonly labels: readonly string[];
    readonly assignees: readonly string[];
    readonly closedBy: string | null;
    readonly updatedAt: Date;
}

/** Every open item, or the reason the list is unusable. */
export type SweptItems =
    | { readonly ok: true; readonly items: readonly SweptItem[] }
    | { readonly ok: false; readonly detail: string };

/** What the driver reads its records through — the adapter's `FactsReader`. */
export interface SweepFacts {
    openItems(): Promise<SweptItems>;
    issueFacts(listed: SweptItem, links: readonly ItemRef[] | Unread): Promise<IssueFacts>;
    pullRequestFacts(
        listed: SweptItem,
        openIssues: readonly SweptItem[],
    ): Promise<PullRequestFacts>;
}

/**
 * A reader built FRESH for each firing.
 * Never one for the process: it memoises each item's clocks for one sweep only.
 */
export type SweepFactsSource = (config: RepositoryConfig) => SweepFacts;

/** The half of the processor this lane drives; see `processFacts`. */
export interface SweepProcessor {
    configuration(): Promise<RepositoryConfig | null>;
    processFacts(input: FactRecordInput): Promise<ShellRecord>;
}

export interface SweepOptions {
    readonly store: Store;
    readonly capabilities: readonly EngineCapability[];
    readonly processor: SweepProcessor;
    readonly facts: SweepFactsSource;
    readonly clock: () => Date;
    /** How long until the next firing. sweep.md §2 step 4; the default is hourly. */
    readonly cadenceMs: number;
    readonly log: Log;
}

/**
 * How often a repository is read when nothing says otherwise — every hour.
 * A clock the sweep cannot see is a promise the App cannot keep: the smallest reap a `duration` may state is two hours.
 */
export const DEFAULT_SWEEP_CADENCE_MS = 60 * 60_000;

/** What the composition root holds: one tick, run whenever the clock says. */
export interface Sweep {
    /** Fire every due sweep row; overlapping calls share the pass already running. */
    runDue(): Promise<void>;
    /** The pass in flight, if any. What a shutdown joins, to free the schedule claim. */
    settled(): Promise<void>;
}

// ─── The driver ──────────────────────────────────────────────────────

/**
 * What one firing produced, for the line it ends with.
 * `unread` separates "nothing is stale" from "this sweep could not tell".
 */
interface Swept {
    readonly items: number;
    readonly decided: number;
    readonly unread: number;
}

/** A firing that read nothing — an unusable list, or a repository that wants none. */
const SWEPT_NOTHING: Swept = { items: 0, decided: 0, unread: 0 };

export function createSweep(options: SweepOptions): Sweep {
    const { store, capabilities, processor, facts, clock, cadenceMs, log } = options;

    const nextDue = (): string => new Date(clock().getTime() + cadenceMs).toISOString();

    /**
     * Every open item, read once, split by kind.
     * One list call covers both kinds because GitHub's issue list carries pull requests too.
     */
    const readRecords = async (
        row: ClaimedScheduleRow,
        config: RepositoryConfig,
    ): Promise<Swept> => {
        const reader = facts(config);
        const listed = await reader.openItems();
        if (!listed.ok) {
            log({ event: "sweepUnreadable", scheduleId: row.scheduleId, detail: listed.detail });
            return SWEPT_NOTHING;
        }
        const issues = listed.items.filter(({ item }) => item.kind === "issue");
        const pulls = listed.items.filter(({ item }) => item.kind === "pullRequest");

        // Pull requests first: their `links` are the only read that says which pull
        // requests an issue has, and the driver reverses them below.

        const inverse = new Map<number, ItemRef[]>();
        let everyLinkRead = true;
        const records: (IssueFacts | PullRequestFacts)[] = [];
        for (const listedPull of pulls) {
            const record = await reader.pullRequestFacts(listedPull, issues);
            records.push(record);
            if (record.links === "unread") {
                everyLinkRead = false;
                continue;
            }
            for (const linked of record.links.issues) {
                const held = inverse.get(linked.item.number) ?? [];
                held.push(record.item);
                inverse.set(linked.item.number, held);
            }
        }
        for (const listedIssue of issues) {
            // A partial inverse is a shorter list, so one unread link read makes every
            // issue's links unread.

            const links: readonly ItemRef[] | Unread = everyLinkRead
                ? (inverse.get(listedIssue.item.number) ?? [])
                : "unread";
            records.push(await reader.issueFacts(listedIssue, links));
        }

        let decided = 0;
        let unread = 0;
        for (const record of records) {
            if (record.links === "unread") unread += 1;
            await processor.processFacts({
                facts: record,
                deliveryId: sweptItemId(row.scheduleId, record.item),
                receivedAt: row.dueAt,
                config,
            });
            decided += 1;
        }
        return { items: listed.items.length, decided, unread };
    };

    /**
     * One firing, from claim to re-arm.
     * The re-arm happens whatever the reading came to: a row left `running` is one only a stale-claim redrive could free.
     */
    const fire = async (row: ClaimedScheduleRow): Promise<void> => {
        log({ event: "sweepClaimed", scheduleId: row.scheduleId, dueAt: row.dueAt });
        let swept = SWEPT_NOTHING;
        try {
            const config = await processor.configuration();
            // Neither an unreadable file nor a repository that wants no sweeping is a
            // reason to read twenty items: re-arm and ask again.

            if (config !== null && wantsSweeping(config, capabilities)) {
                swept = await readRecords(row, config);
            }
        } catch (error) {
            log({ event: "sweepFailed", detail: detailOf(error) });
        }
        const nextDueAt = nextDue();
        if (!store.scheduleAgain(row.scheduleId, row.claimToken, nextDueAt)) {
            // A redrive took the claim over while this firing ran; whoever holds it now
            // owns the next due date, and the reading just done was thrown away.

            log({ event: "sweepFailed", detail: `the claim on "${row.scheduleId}" was lost` });
            return;
        }
        log({ event: "sweepFinished", scheduleId: row.scheduleId, ...swept, nextDueAt });
    };

    /**
     * Every row this tick claimed, fired or handed back.
     * Nothing here may reject: a rejection would reach `settled()`, where a shutdown awaiting it has nowhere to put it.
     */
    const fireDue = async (): Promise<void> => {
        try {
            const due: readonly ClaimedScheduleRow[] = store.claimDue(clock().toISOString());
            for (const row of due) {
                if (row.effect === SWEEP_EFFECT) {
                    await fire(row);
                    continue;
                }
                // `claimDue` claims every due row and `schedule.ts` is the only declarer, so
                // this is a future effect's row with no driver here. Hand the claim back.

                log({
                    event: "sweepFailed",
                    detail: `schedule "${row.scheduleId}" carries the unknown effect "${row.effect}"`,
                });
                store.scheduleAgain(row.scheduleId, row.claimToken, nextDue());
            }
        } catch (error) {
            log({ event: "sweepFailed", detail: detailOf(error) });
        }
    };

    let firing: Promise<void> | null = null;
    return {
        runDue(): Promise<void> {
            firing ??= (async () => {
                try {
                    await fireDue();
                } finally {
                    firing = null;
                }
            })();
            return firing;
        },
        settled: () => firing ?? Promise.resolve(),
    };
}
