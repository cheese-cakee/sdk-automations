/**
 * The sweep driver: a due schedule row becomes one fact record per open item,
 * and each record becomes one decision — `design/guides/sweep.md` §2.
 *
 * The webhook lane exists because GitHub told us something. This lane exists
 * because nobody did: a clock-driven capability judges how long an item has sat
 * still, and an item sitting still emits no events. So the platform reads the
 * repository on a cadence instead, and the ONE difference from a delivery is
 * where the record came from — the mode gate, `decide()`, the applier, the
 * effect journal and recovery are all the delivery lane's, reached through
 * `processFacts`.
 *
 * THE ORDER IS THE PRODUCT, as it is everywhere else in this package:
 *
 * ```
 * claim the row → read the config → list the open items once
 *   → pull requests first, because their links are the issues' links reversed
 *   → then the issues, each carrying the inverse
 *   → one decision per record
 *   → arm the next firing and release the claim, in one statement
 * ```
 *
 * Pull requests come first for a reason worth stating: an issue's open linked
 * pull requests are the inverse of the pull requests' own link reads, and there
 * is no second read that answers it. Which means the honesty rule has a
 * consequence here — if ANY pull request's links went unread, the issues' links
 * go unread too, because a partial inverse is a shorter list, and a shorter list
 * is the lie `Unread` exists to refuse.
 *
 * Nothing here throws at its caller. One firing's failure is one firing's, and
 * the row is always re-armed: a sweep that gave up on its schedule because
 * GitHub was slow once would be a sweep that stops.
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
 *
 * Restated rather than imported for the reason `EffectWriter` is:
 * `.dependency-cruiser.cjs` admits the adapter at `main.ts` and nowhere else,
 * so the shell names the shape it needs and the composition root passes the
 * adapter's own object, which satisfies it structurally. `main.ts` is where the
 * two are checked against each other.
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
 *
 * Never one reader for the process: the reader memoises each item's clocks for
 * the length of one sweep, which is right for one sweep and stale by the next.
 * The same rule the applier's externals source carries, for the same reason.
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
    /** How long until the next firing. sweep.md §2 step 4; the default is daily. */
    readonly cadenceMs: number;
    readonly log: Log;
}

/** How often a repository is read when nothing says otherwise. */
export const DEFAULT_SWEEP_CADENCE_MS = 24 * 60 * 60_000;

/** What the composition root holds: one tick, run whenever the clock says. */
export interface Sweep {
    /**
     * Fire every due sweep row. One firing's failure is one firing's, and
     * overlapping calls share the pass already running — a tick that arrives
     * while a long sweep is mid-read must not start a second one against the
     * same rows.
     */
    runDue(): Promise<void>;
    /**
     * The pass in flight, if any; resolved at once when none is. What a
     * shutdown joins, for the same reason it joins the processor's: a firing
     * abandoned mid-read holds a schedule claim nothing will free until a
     * redrive.
     */
    settled(): Promise<void>;
}

// ─── The driver ──────────────────────────────────────────────────────

/**
 * What one firing produced, for the line it ends with.
 *
 * `unread` counts the records whose links went unread, because that number is
 * the difference between "this repository has nothing stale" and "this sweep
 * could not tell" — and an operator reading a quiet log deserves to know which.
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
     *
     * One list call covers both kinds because GitHub's issue list carries pull
     * requests too — which is also why the sweep costs what sweep.md §3 says it
     * costs rather than twice that.
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

        // Pull requests first: their `links` are the only read that says which
        // pull requests an issue has, and the driver reverses them below.
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
            // A partial inverse is a shorter list, and a shorter list would tell
            // the issue ladder that nothing is being worked on — so one unread
            // link read makes every issue's links unread.
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
     *
     * The re-arm happens whatever the reading came to. A firing that failed has
     * still spent its turn, and a row left `running` is one only a stale-claim
     * redrive could free — a repository nobody reads, bought for nothing. A
     * reading failure is contained here for the same reason: it is one firing's,
     * and the next one is a cadence away.
     */
    const fire = async (row: ClaimedScheduleRow): Promise<void> => {
        log({ event: "sweepClaimed", scheduleId: row.scheduleId, dueAt: row.dueAt });
        let swept = SWEPT_NOTHING;
        try {
            const config = await processor.configuration();
            // Neither a file nobody could read nor a repository that wants no
            // sweeping is a reason to read twenty items: re-arm and ask again.
            if (config !== null && wantsSweeping(config, capabilities)) {
                swept = await readRecords(row, config);
            }
        } catch (error) {
            log({ event: "sweepFailed", detail: detailOf(error) });
        }
        const nextDueAt = nextDue();
        if (!store.scheduleAgain(row.scheduleId, row.claimToken, nextDueAt)) {
            // A redrive took the claim over while this firing ran. Whoever holds
            // it now owns the next due date; saying so is all this can do, and
            // it is worth saying — the reading just done was thrown away.
            log({ event: "sweepFailed", detail: `the claim on "${row.scheduleId}" was lost` });
            return;
        }
        log({ event: "sweepFinished", scheduleId: row.scheduleId, ...swept, nextDueAt });
    };

    /**
     * Every row this tick claimed, fired or handed back.
     *
     * The one try covers the STORE, which is what is left once `fire` has
     * contained its own reading. Nothing here may reject: a rejection would
     * reach `settled()`, and a shutdown awaiting that has nowhere to put it.
     */
    const fireDue = async (): Promise<void> => {
        try {
            const due: readonly ClaimedScheduleRow[] = store.claimDue(clock().toISOString());
            for (const row of due) {
                if (row.effect === SWEEP_EFFECT) {
                    await fire(row);
                    continue;
                }
                // `claimDue` claims every due row, and `schedule.ts` is the only
                // declarer there is — so this is a row from a future effect with
                // no driver in this process. Hand the claim back rather than
                // hold it: a row nobody can fire must still be somebody's.
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
