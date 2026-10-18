/**
 * What a protocol module is and is given: its identity and whether it writes or runs long, the
 * context it runs in, and the verdict it returns. The helpers here are the steps protocols share.
 */

import type { ItemRef } from "@hiero-hackers/automation-core";
import { Halt, type Call } from "../../github.js";
import { actionEventsSince, countDifferences, countsOf, type LogRow } from "../judge.js";
import type { Comment, Person } from "../person.js";
import type { Provoker } from "../provoke.js";
import type { Evidence } from "../record.js";
import type { Sandbox } from "../sandbox.js";
import type { Watch } from "../watch.js";
import { effectLinesIn } from "../runs.js";

export interface Verdict {
    readonly result: "passed" | "failed" | "skipped";
    readonly notes: readonly string[];
}

export const passed = (notes: readonly string[] = []): Verdict => ({ result: "passed", notes });

export const skipped = (reason: string): Verdict => ({ result: "skipped", notes: [reason] });

/** Passed where no difference was found, failed with the differences otherwise. */
export const verdictOf = (
    differences: readonly string[],
    notes: readonly string[] = [],
): Verdict =>
    differences.length === 0
        ? passed(notes)
        : { result: "failed", notes: [...differences, ...notes] };

/** What a reading of the allowance takes from the token the workflow shares. */
export type RateReader = () => Promise<RateReading>;

export interface Pool {
    readonly used: number;
    readonly reset: number;
}

export interface RateReading {
    readonly core: Pool;
    readonly graphql: Pool;
}

export interface Context {
    readonly owner: string;
    readonly repo: string;
    readonly defaultBranch: string;
    readonly call: Call;
    readonly sandbox: Sandbox;
    readonly provoker: Provoker;
    readonly person: Person;
    readonly watch: Watch;
    readonly evidence: Evidence;
    /** `null` where no token the workflow shares is known. */
    readonly rate: RateReader | null;
    /** The token acts as a person, not as an App. */
    readonly human: boolean;
    readonly long: boolean;
    /** The capabilities protocol 9.1 is limited to; none means all. */
    readonly capabilities: readonly string[];
    /** Titles and branches carry it. */
    readonly tag: string;
    sleep(ms: number): Promise<void>;
}

export interface Protocol {
    readonly id: string;
    readonly slug: string;
    readonly writes: boolean;
    readonly long: boolean;
    run(context: Context): Promise<Verdict>;
}

export const issueRef = (number: number): ItemRef => ({ kind: "issue", number });

export const pullRef = (number: number): ItemRef => ({ kind: "pullRequest", number });

/** The Action's own events on an item since a moment, counted against what was expected. */
export async function actionWrites(
    context: Context,
    item: ItemRef,
    since: string,
    expected: Readonly<Record<string, number>>,
): Promise<string[]> {
    const events = actionEventsSince(await context.watch.timeline(item), since);
    return countDifferences(`${item.kind}#${String(item.number)}`, countsOf(events), expected);
}

/** The codes the rows carry, sorted. */
export const codesOf = (rows: readonly LogRow[]): string[] =>
    rows.map((row) => `${row.capability} ${row.verdict} ${row.code ?? "-"}`).sort();

/** How many effects the logs announce as applied. */
export const appliedIn = (texts: readonly string[]): number =>
    texts.flatMap((text) => effectLinesIn(text)).filter((line) => line.outcome === "applied")
        .length;

/** The Action's events across several items, counted against the effects its logs applied. */
export function writeCountDifferences(applied: number, written: number): string[] {
    return applied === written
        ? []
        : [`the logs applied ${String(applied)} effects; GitHub shows ${String(written)} writes`];
}

/** Dispatches one sweep by hand, waits for it, keeps its log; answers the log text. */
export async function sweepOnce(context: Context, suffix: string): Promise<string> {
    const since = await context.sandbox.dispatch();
    const settled = await context.watch.settle(since, ["workflow_dispatch"]);
    if ("failed" in settled) throw new Halt(`the sweep: ${settled.failed}`);
    return (await context.watch.read(settled.runs, suffix)).texts.join("\n");
}

/** The comments on an item by the Action, in order. */
export async function botComments(context: Context, issue: number): Promise<Comment[]> {
    return (await context.person.commentsOf(issue)).filter((comment) => comment.login === BOT);
}

export const BOT = "github-actions[bot]";
