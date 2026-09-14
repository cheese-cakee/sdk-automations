/**
 * `pnpm shell:status`: what the store can say about the platform now (D168).
 * One read per line, printed as plain lines — it changes nothing, like `explain.ts`.
 */

import { existsSync } from "node:fs";
import {
    Store,
    type DeliveryCounts,
    type NewestDelivery,
    type OpenSendTally,
    type ScheduleStanding,
    type StandingWarnings,
    type VerdictTally,
} from "../../store/index.js";
import { storeFile } from "../paths.js";

/** What the store answered: the lines to print, and whether a store was there. */
export interface Status {
    readonly opened: boolean;
    readonly lines: readonly string[];
}

/** How far back the decisions line counts, and the window it prints. */
const DECISION_WINDOW_HOURS = 24;

const HOUR_MS = 60 * 60_000;

/** How a column that holds nothing is spelled. */
const NOTHING = "—";

/** The column every line's question is written in. */
const LABEL = 13;

const line = (label: string, fields: readonly string[]): string =>
    label.padEnd(LABEL) + fields.join("   ");

/** A count, grouped in threes so a four-figure one reads at a glance. */
const count = (value: number): string => String(value).replace(/\B(?=(\d{3})+$)/g, ",");

/** To the second; every stored instant is the millisecond-precision UTC form. */
const instant = (value: string | null): string =>
    value === null ? NOTHING : `${value.slice(0, 19)}Z`;

const deliveries = (counts: DeliveryCounts): string =>
    line("deliveries", [
        `pending ${count(counts.pending)}`,
        `processing ${count(counts.processing)}`,
        `failed ${count(counts.failed)}`,
        `done ${count(counts.done)} (oldest ${instant(counts.oldestDone)})`,
    ]);

const seconds = (from: string, to: string): number =>
    Math.round((Date.parse(to) - Date.parse(from)) / 1000);

/** How long the newest delivery waited for its decision — the only delay the store holds. */
function delay(newest: NewestDelivery | null): string {
    if (newest === null) return line("delay", ["no delivery"]);
    const decided =
        newest.completedAt === null
            ? "not decided yet"
            : `decided ${count(seconds(newest.receivedAt, newest.completedAt))} s later`;
    return line("delay", [`newest delivery received ${instant(newest.receivedAt)}, ${decided}`]);
}

const sends = (tally: OpenSendTally): string =>
    line("sends", [`open ${count(tally.count)}`, `(oldest ${instant(tally.oldest)})`]);

const warnings = (standing: StandingWarnings): string =>
    line("warnings", [
        `standing ${count(standing.count)}`,
        `(next due ${instant(standing.nextDue)})`,
    ]);

/** One line per declared row, and one saying nothing is scheduled when none is. */
const schedules = (rows: readonly ScheduleStanding[]): string[] =>
    rows.length === 0
        ? [line("sweep", [NOTHING])]
        : rows.map((row) =>
              line("sweep", [
                  row.scheduleId,
                  row.status,
                  `due ${instant(row.dueAt)}`,
                  `claimed ${instant(row.claimedAt)}`,
              ]),
          );

const decisions = (tallies: readonly VerdictTally[]): string =>
    line("decisions", [
        `last ${String(DECISION_WINDOW_HOURS)} h: ${
            tallies.length === 0
                ? NOTHING
                : tallies.map((tally) => `${count(tally.count)} ${tally.verdict}`).join(", ")
        }`,
    ]);

/** Every question the store can answer about itself, one read each (D168). */
export function status(store: Store, now: Date): readonly string[] {
    const since = new Date(now.getTime() - DECISION_WINDOW_HOURS * HOUR_MS).toISOString();
    return [
        deliveries(store.inbox.counts()),
        delay(store.inbox.newestDelivery()),
        sends(store.ledger.stillOpen()),
        warnings(store.ledger.standingWarnings(now.toISOString())),
        ...schedules(store.ledger.schedules()),
        decisions(store.ledger.verdictsSince(since)),
    ];
}

/** The command: open the store the environment names, or say it is not there. */
export function readStatus(
    env: Readonly<Partial<Record<string, string>>> = process.env,
    now: Date = new Date(),
): Status {
    const path = storeFile(env);
    if (!existsSync(path)) return { opened: false, lines: [`no store at ${path}`] };
    const store = new Store(path);
    try {
        return { opened: true, lines: status(store, now) };
    } finally {
        store.close();
    }
}
