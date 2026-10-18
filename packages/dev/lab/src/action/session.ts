/**
 * Running the selected protocols one after another: each is begun, run, and its sandbox put
 * back whether it passed, failed or threw. What each did becomes one outcome and one table row.
 */

import { messageOf } from "../github.js";
import type { Skip } from "./cli.js";
import type { Context, Protocol, Verdict } from "./protocols/kit.js";

export interface Outcome {
    readonly id: string;
    readonly result: Verdict["result"];
    readonly notes: readonly string[];
    readonly seconds: number;
    readonly directory: string | null;
}

/** What the run does before a protocol and after it. */
export interface Controls {
    begin(): Promise<void>;
    /** Puts the sandbox back; answers each change that could not be read back as undone. */
    restore(): Promise<string[]>;
}

export interface Contexts {
    contextFor(protocol: Protocol): { readonly context: Context; readonly directory: string };
}

/** Each protocol run in turn; a throw is that protocol's failure, and the rest still run. */
export async function execute(
    selected: readonly Protocol[],
    controls: Controls,
    contexts: Contexts,
    interrupted: () => boolean,
    clock: () => number = Date.now,
): Promise<Outcome[]> {
    const outcomes: Outcome[] = [];
    for (const protocol of selected) {
        if (interrupted()) {
            outcomes.push({
                id: protocol.id,
                result: "skipped",
                notes: ["interrupted"],
                seconds: 0,
                directory: null,
            });
            continue;
        }
        const began = clock();
        const { context, directory } = contexts.contextFor(protocol);
        let verdict: Verdict;
        try {
            await controls.begin();
            verdict = await protocol.run(context);
        } catch (error) {
            verdict = { result: "failed", notes: [`halted: ${messageOf(error)}`] };
        }
        let problems: string[];
        try {
            problems = await controls.restore();
        } catch (error) {
            problems = [messageOf(error)];
        }
        const notes = [
            ...verdict.notes,
            ...problems.map((problem) => `NOT RESTORED, do by hand: ${problem}`),
        ];
        outcomes.push({
            id: protocol.id,
            result: problems.length > 0 ? "failed" : verdict.result,
            notes,
            seconds: Math.round((clock() - began) / 1000),
            directory,
        });
    }
    return outcomes;
}

export function skippedOutcomes(skipped: readonly Skip[]): Outcome[] {
    return skipped.map(({ id, reason }) => ({
        id,
        result: "skipped",
        notes: [reason],
        seconds: 0,
        directory: null,
    }));
}

const LABEL: Record<Verdict["result"], string> = {
    passed: "PASSED",
    failed: "FAILED",
    skipped: "skipped",
};

/** One line a protocol, and the first thing to read under each that did not pass. */
export function verdictTable(outcomes: readonly Outcome[]): string {
    const sorted = [...outcomes].sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
    const rows = sorted.map(
        (outcome) =>
            `${outcome.id.padEnd(5)}${LABEL[outcome.result].padEnd(9)}${String(outcome.seconds).padStart(6)} s  ${outcome.directory ?? "-"}`,
    );
    const reasons = sorted
        .filter((outcome) => outcome.result !== "passed")
        .flatMap((outcome) => outcome.notes.slice(0, 3).map((note) => `  ${outcome.id}: ${note}`));
    return [...rows, ...reasons].join("\n");
}

/** Exit 1 where any protocol that ran failed. */
export const exitCodeOf = (outcomes: readonly Outcome[]): number =>
    outcomes.some((outcome) => outcome.result === "failed") ? 1 : 0;
