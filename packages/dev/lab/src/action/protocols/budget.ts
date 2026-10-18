/**
 * Protocol 9.7: the hourly sweep on about 300 open items against the token's request budget.
 * The items are made with the workflow disabled, one dispatched sweep is read, and its
 * reported spend is reconciled with the drop in the allowance before the items are closed.
 */

import { field, Halt } from "../../github.js";
import { configOf } from "../configs.js";
import { eventsIn, limitAnswersIn } from "../runs.js";
import { sweepOnce, verdictOf, type Protocol, type RateReading } from "./kit.js";

export const ITEMS = 300;

/** What a runner token may spend in an hour. */
export const POOL = 1_000;

/** A conditional read, or the allowance's own rounding, may move the count by this much. */
export const SLACK = 5;

/** Content creation: under 80 a minute and 500 an hour. */
const CREATE_PACE_MS = 1_200;

const CLOSE_PACE_MS = 800;

/** Sweeps dispatched after the first, to watch the remainder drain. */
const FOLLOWING = 4;

export interface Spend {
    readonly core: number;
    readonly graphql: number;
}

/** The drop in the allowance against the spend reported: the differences, and what could not be compared. */
export function reconcile(
    before: RateReading,
    after: RateReading,
    spent: Spend,
): { readonly differences: string[]; readonly notes: string[] } {
    const differences: string[] = [];
    const notes: string[] = [];
    if (spent.core > POOL)
        differences.push(
            `spent ${String(spent.core)} core calls, over the pool of ${String(POOL)}`,
        );
    for (const pool of ["core", "graphql"] as const) {
        if (before[pool].reset !== after[pool].reset) {
            notes.push(`${pool}: the window rolled over, so the drop cannot be read`);
            continue;
        }
        const drop = after[pool].used - before[pool].used;
        if (Math.abs(drop - spent[pool]) > SLACK) {
            differences.push(
                `${pool}: the allowance dropped by ${String(drop)}, the sweep reports ${String(spent[pool])}`,
            );
        }
    }
    return { differences, notes };
}

/** The `spent` of a `sweepFinished` event, or `null` where it is not shaped as one. */
export function spendOf(event: Readonly<Record<string, unknown>>): Spend | null {
    const [core, graphql] = [field(event["spent"], "core"), field(event["spent"], "graphql")];
    return typeof core === "number" && typeof graphql === "number" ? { core, graphql } : null;
}

export const budget: Protocol = {
    id: "9.7",
    slug: "budget",
    writes: false,
    long: false,
    async run(context) {
        const { sandbox, call, owner, repo, tag, evidence } = context;
        const differences: string[] = [];
        const notes: string[] = [];
        await sandbox.setWorkflow(false);
        const numbers: number[] = [];
        for (let n = 1; n <= ITEMS; n += 1) {
            const made = await call("POST", `/repos/${owner}/${repo}/issues`, {
                body: {
                    title: `lab-${tag}-9.7-${String(n)}`,
                    body: "Temporary fixture for the budget protocol.",
                },
                accept: [201],
            });
            const number = field(made.body, "number");
            if (typeof number !== "number") throw new Halt("an issue was created without a number");
            sandbox.adoptIssue(number);
            numbers.push(number);
            await context.sleep(CREATE_PACE_MS);
        }
        await sandbox.switchConfig(
            configOf("dry-run", ["triageQueue", "prDashboard"]),
            `lab ${tag}: 9.7 dry-run`,
        );
        await sandbox.setWorkflow(true);

        const before = context.rate === null ? null : await context.rate();
        const text = await sweepOnce(context, "-sweep1");
        const after = context.rate === null ? null : await context.rate();
        const finished = eventsIn(text, "sweepFinished");
        const first = finished[0];
        const spent = first === undefined ? null : spendOf(first);
        if (first === undefined || spent === null)
            differences.push("no sweepFinished with a spend in the log");
        else {
            evidence.record("sweepFinished", first);
            notes.push(`first sweep: ${JSON.stringify(first)}`);
            if (before === null || after === null) {
                notes.push("unreconciled: no token the workflow shares (set RATE_LIMIT_TOKEN)");
                if (spent.core > POOL)
                    differences.push(
                        `spent ${String(spent.core)} core calls, over the pool of ${String(POOL)}`,
                    );
            } else {
                const reconciled = reconcile(before, after, spent);
                differences.push(...reconciled.differences);
                notes.push(...reconciled.notes);
            }
        }
        const limited = limitAnswersIn(text);
        if (limited.length > 0)
            differences.push(
                `${String(limited.length)} lines read as a limit answer: ${limited[0] ?? ""}`,
            );

        let remaining = typeof first?.["remaining"] === "number" ? first["remaining"] : 0;
        let runs = 1;
        while (remaining > 0 && runs <= FOLLOWING) {
            const next = eventsIn(
                await sweepOnce(context, `-sweep${String(runs + 1)}`),
                "sweepFinished",
            )[0];
            runs += 1;
            remaining = typeof next?.["remaining"] === "number" ? next["remaining"] : 0;
            notes.push(`sweep ${String(runs)}: ${JSON.stringify(next ?? null)}`);
        }
        notes.push(`${String(runs)} sweeps, ${String(remaining)} items remaining`);

        await sandbox.setWorkflow(false);
        for (const number of numbers) {
            await sandbox.closeIssue(number);
            await context.sleep(CLOSE_PACE_MS);
        }
        return verdictOf(differences, notes);
    },
};
