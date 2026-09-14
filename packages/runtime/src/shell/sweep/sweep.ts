/**
 * The sweep driver: a due schedule row becomes one fact record per open item, and
 * each becomes one decision (sweep.md §2). This lane exists because nobody told us.
 * A firing is also the only thing that prunes: the three retention windows (D166).
 */

import type {
    EngineCapability,
    IssueFacts,
    ItemRef,
    PullRequestFacts,
    RepositoryConfig,
    RepositoryRef,
    Unread,
} from "@hiero-hackers/automation-core";
import type { ClaimedScheduleRow, Store } from "../../store/index.js";
import type { WriteBudget } from "../apply/apply.js";
import type { DecideItem, Decided } from "../decide/item.js";
import { repositoryOfScheduleId, SWEEP_EFFECT, wantsSweeping } from "../decide/schedule.js";
import { detailOf, type Log } from "../log.js";

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

export interface RequestBudget {
    remaining: number;
    exhausted?: boolean;
}

/**
 * A reader built FRESH for each firing.
 * Never one for the process: it memoises each item's clocks for one sweep only.
 */
export type SweepFactsSource = (config: RepositoryConfig, budget: RequestBudget) => SweepFacts;

/** How ONE repository is swept: its reader, the shared box, and the file both lanes gate on. */
export interface SweepProcessor {
    configuration(): Promise<RepositoryConfig | null>;
    decideItem: DecideItem;
    facts: SweepFactsSource;
}

export interface SweepOptions {
    readonly store: Store;
    readonly capabilities: readonly EngineCapability[];
    /** One repository's processor; a due row's id names which (D169). */
    readonly processorFor: (repository: RepositoryRef) => SweepProcessor;
    readonly clock: () => Date;
    /** How long until the next firing. sweep.md §2 step 4; the default is hourly. */
    readonly cadenceMs: number;
    /** How many writes one firing may send; the default is `SWEEP_WRITE_CALLS`. */
    readonly writeCap: number;
    /** How many requests one firing may spend reading; the default is `SWEEP_READ_REQUESTS`. */
    readonly readBudget: number;
    /** What the budget above is spent against: the client's own count of requests sent. */
    readonly requestsMade: () => number;
    /** The installation switch (D171): a firing reads nothing, and still prunes and re-arms. */
    readonly suspended?: boolean;
    readonly log: Log;
}

const DAY_MS = 24 * 60 * 60_000;

/** How long a done delivery and its report are kept — the deliveries API's own window (D166). */
export const DONE_DELIVERY_RETENTION_DAYS = 30;

/** How long a decision row is kept (D166). */
export const DECISION_RETENTION_DAYS = 30;

/** How long a settled effect's facts are kept (D166). */
export const SETTLED_EFFECT_RETENTION_DAYS = 90;

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
 * `writes` is what the cap spent and `heldBack` what it turned away (D167).
 */
interface Swept {
    readonly items: number;
    readonly decided: number;
    readonly unread: number;
    readonly writes: number;
    readonly heldBack: number;
    /** Items past the read budget, left for the next firing (D170). */
    readonly remaining: number;
    /** Where the next firing starts reading; null reads the list again from the beginning. */
    readonly resumeAfter: number | null;
    /** Requests this firing's reading spent of the budget (D170). */
    readonly requests: number;
}

/**
 * A firing that read nothing — an unusable list, a suspension, or a repository that wants none.
 * The cursor is handed back as it stood: nothing was read, so nothing moved it.
 */
const nothingRead = (row: ClaimedScheduleRow, requests = 0): Swept => ({
    items: 0,
    decided: 0,
    unread: 0,
    writes: 0,
    heldBack: 0,
    remaining: 0,
    resumeAfter: row.resumeAfter,
    requests,
});

/** How many of one item's effects the write cap turned away. */
const heldBackIn = (decided: Decided): number =>
    decided.kind === "decided"
        ? decided.outcomes.filter((outcome) => outcome.code === "sweepWriteCap").length
        : 0;

/**
 * What this firing may read: past the cursor, by number ascending (D170).
 * The budget stops the walk over these; nothing here knows about it.
 */
function afterCursor(items: readonly SweptItem[], after: number | null): readonly SweptItem[] {
    return items
        .filter(({ item }) => after === null || item.number > after)
        .sort((left, right) => left.item.number - right.item.number);
}

/** Why a claimed row is handed straight back: no driver here, or no repository in its id. */
function undrivable(row: ClaimedScheduleRow): string {
    return row.effect === SWEEP_EFFECT
        ? `schedule "${row.scheduleId}" names no repository`
        : `schedule "${row.scheduleId}" carries the unknown effect "${row.effect}"`;
}

export function createSweep(options: SweepOptions): Sweep {
    const {
        store,
        capabilities,
        processorFor,
        clock,
        cadenceMs,
        writeCap,
        readBudget,
        requestsMade,
        suspended = false,
        log,
    } = options;

    const nextDue = (): string => new Date(clock().getTime() + cadenceMs).toISOString();

    /**
     * Every open item the budget's requests reach, read once, in number order.
     * One list call covers both kinds because GitHub's issue list carries pull requests too.
     */
    const readRecords = async (
        row: ClaimedScheduleRow,
        config: RepositoryConfig,
        processor: SweepProcessor,
    ): Promise<Swept> => {
        const before = requestsMade();
        const spent = (): number => requestsMade() - before;
        const requestBudget: RequestBudget = { remaining: readBudget, exhausted: false };
        const reader = processor.facts(config, requestBudget);
        const listed = await reader.openItems();
        if (!listed.ok) {
            log({ event: "sweepUnreadable", scheduleId: row.scheduleId, detail: listed.detail });
            return nothingRead(row, spent());
        }
        const eligible = afterCursor(listed.items, row.resumeAfter);
        // Joined against every listed issue, not this firing's window: reading one more
        // item's clocks is a request, and requests are what the budget counts (D170).

        const issues = listed.items.filter(({ item }) => item.kind === "issue");

        // A pull request's `links` are the only read that says which pull requests an
        // issue has, so the driver reverses them and completes each issue's below.

        const inverse = new Map<number, ItemRef[]>();
        let everyLinkRead = true;
        const records: (IssueFacts | PullRequestFacts)[] = [];
        let read = 0;
        for (const listedItem of eligible) {
            // In number order, one item at a time: what a firing read is then a prefix of
            // the list, which is what the cursor below hands to the next one.

            if (requestBudget.remaining === 0) break;
            let record: IssueFacts | PullRequestFacts;
            if (listedItem.item.kind === "issue") {
                record = await reader.issueFacts(
                    listedItem,
                    inverse.get(listedItem.item.number) ?? [],
                );
            } else {
                record = await reader.pullRequestFacts(listedItem, issues);
            }
            if (requestBudget.exhausted) break;
            read += 1;
            records.push(record);
            if (record.kind === "issue") continue;
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
        const requests = spent();
        const remaining = eligible.length - read;
        const resumeAfter =
            remaining === 0 ? null : (eligible[read - 1]?.item.number ?? row.resumeAfter);
        const linksComplete = row.resumeAfter === null && remaining === 0 && everyLinkRead;

        /**
         * One record as it goes down: an issue's links, against every pull request read.
         * A partial inverse is a shorter list, so one unread link read makes every issue's unread.
         */
        const completed = (
            record: IssueFacts | PullRequestFacts,
        ): IssueFacts | PullRequestFacts => {
            if (record.kind !== "issue" || record.links === "unread") return record;
            if (!linksComplete) return { ...record, links: "unread" };
            return {
                ...record,
                links: { openPullRequests: inverse.get(record.item.number) ?? [] },
            };
        };

        // One budget for the firing: what it holds back is decided again next time.

        const writeBudget: WriteBudget = { remaining: writeCap };
        let decided = 0;
        let unread = 0;
        let heldBack = 0;
        for (const record of records.map(completed)) {
            if (record.links === "unread") unread += 1;
            const answer = await processor.decideItem(
                { kind: "facts", scheduleId: row.scheduleId, facts: record },
                config,
                row.dueAt,
                writeBudget,
            );
            heldBack += heldBackIn(answer);
            decided += 1;
        }
        if (resumeAfter !== null) {
            log({
                event: "sweepPartial",
                scheduleId: row.scheduleId,
                read,
                remaining,
                resumeAfter,
                requests,
            });
        }
        return {
            items: listed.items.length,
            decided,
            unread,
            writes: writeCap - writeBudget.remaining,
            heldBack,
            remaining,
            resumeAfter,
            requests,
        };
    };

    /** The three retention windows, run once per firing and contained on their own (D166). */
    const pruneRetained = (): void => {
        try {
            const now = clock().getTime();
            const before = (days: number): string => new Date(now - days * DAY_MS).toISOString();
            const deliveries = store.inbox.pruneCompletedDeliveries(
                before(DONE_DELIVERY_RETENTION_DAYS),
            );
            const effects = store.ledger.prune(before(SETTLED_EFFECT_RETENTION_DAYS));
            const decisions = store.ledger.pruneDecisions(before(DECISION_RETENTION_DAYS));
            if (deliveries > 0 || effects > 0 || decisions > 0) {
                log({ event: "sweepPruned", deliveries, effects, decisions });
            }
        } catch (error) {
            log({ event: "sweepFailed", detail: detailOf(error) });
        }
    };

    /**
     * What this firing read — nothing, where a suspension or the file says so (D171).
     * Contained: the reading is the only half of a firing that may fail, and the re-arm below has to happen anyway.
     */
    const readingOf = async (
        row: ClaimedScheduleRow,
        processor: SweepProcessor,
    ): Promise<Swept> => {
        if (suspended) {
            log({ event: "sweepSuspended", scheduleId: row.scheduleId });
            return nothingRead(row);
        }
        try {
            const config = await processor.configuration();
            // Neither an unreadable file nor a repository that wants no sweeping is a
            // reason to read twenty items: re-arm and ask again.

            if (config !== null && wantsSweeping(config, capabilities)) {
                return await readRecords(row, config, processor);
            }
        } catch (error) {
            log({ event: "sweepFailed", detail: detailOf(error) });
        }
        return nothingRead(row);
    };

    /**
     * One firing, from claim to re-arm.
     * The re-arm happens whatever the reading came to: a row left `running` is one only a stale-claim redrive could free.
     */
    const fire = async (row: ClaimedScheduleRow, repository: RepositoryRef): Promise<void> => {
        log({ event: "sweepClaimed", scheduleId: row.scheduleId, dueAt: row.dueAt });
        const swept = await readingOf(row, processorFor(repository));
        pruneRetained();
        const nextDueAt = nextDue();
        if (
            !store.ledger.scheduleAgain(
                row.scheduleId,
                row.claimToken,
                nextDueAt,
                swept.resumeAfter,
            )
        ) {
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
            const due: readonly ClaimedScheduleRow[] = store.ledger.claimDue(clock().toISOString());
            for (const row of due) {
                const repository = repositoryOfScheduleId(row.scheduleId);
                if (row.effect === SWEEP_EFFECT && repository !== null) {
                    await fire(row, repository);
                    continue;
                }
                // `claimDue` claims every due row, so this is a future effect's row with no
                // driver here, or a sweep row whose id lost its name. Hand the claim back.

                log({ event: "sweepFailed", detail: undrivable(row) });
                store.ledger.scheduleAgain(
                    row.scheduleId,
                    row.claimToken,
                    nextDue(),
                    row.resumeAfter,
                );
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
