/**
 * Protocol 9.1: each capability's dry-run config in turn, the captured events provoked as the
 * person, and the decision rows held to the journeys table. Nothing is armed.
 */

import { Halt } from "../../github.js";
import { CASES, type Case, type EventCase } from "../cases.js";
import { readBackDifferences, rowDifferences } from "../judge.js";
import type { Subject } from "../provoke.js";
import { verdictOf, type Context, type Protocol } from "./kit.js";

const EXPERIMENT = "action-rehearsal";

/** Between provocations: bounded hostility. */
const PACE_MS = 5_000;

interface StepResult {
    readonly capture: string;
    readonly differences: readonly string[];
}

function selected(names: readonly string[]): readonly Case[] {
    const unknown = names.filter((name) => !CASES.some((held) => held.capability === name));
    if (unknown.length > 0) throw new Halt(`no capability named ${unknown.join(", ")}`);
    return names.length === 0 ? CASES : CASES.filter((held) => names.includes(held.capability));
}

/** One event: provoked, settled, read and judged; its differences name why it failed. */
async function step(
    context: Context,
    held: Case,
    event: EventCase,
    subject: Subject,
    name: string,
): Promise<StepResult> {
    const { evidence, watch } = context;
    const record = { capability: held.capability, capture: event.capture };
    await context.sleep(PACE_MS);
    const { item, since } = await context.provoker.provoke(event.action, subject, name);
    evidence.record("provoke", { ...record, action: event.action, item, since });
    const settled = await watch.settle(since, event.raises);
    if ("failed" in settled) {
        evidence.record("settle", { ...record, item, failed: settled.failed });
        return { capture: event.capture, differences: [settled.failed] };
    }
    const read = await watch.read(settled.runs);
    const differences = [
        ...rowDifferences(item, event.expected, read.rows),
        ...readBackDifferences(await watch.timeline(item), since),
        ...read.malformed.map((line) => `a row line that is not a row: ${line}`),
    ];
    evidence.record("judge", {
        ...record,
        item,
        runs: settled.runs.map((run) => run.id),
        rows: read.rows,
        expected: event.expected,
        differences,
    });
    return { capture: event.capture, differences };
}

/** One capability: its config switched, each event stepped until one fails. */
async function rehearse(context: Context, held: Case): Promise<string[]> {
    const subject: Subject = { issue: null, pull: null };
    const name = `${EXPERIMENT}-${context.tag}-${held.capability}`;
    for (const event of held.events) {
        const result = await step(context, held, event, subject, name);
        if (result.differences.length > 0) {
            return result.differences.map(
                (line) => `${held.capability} ${result.capture}: ${line}`,
            );
        }
    }
    return [];
}

export const conformance: Protocol = {
    id: "9.1",
    slug: "action-conformance",
    writes: false,
    long: false,
    async run(context) {
        const differences: string[] = [];
        await context.sandbox.prepare();
        for (const held of selected(context.capabilities)) {
            const sha = await context.sandbox.switchConfig(
                held.config,
                `lab ${context.tag}: ${held.capability} in dry-run`,
            );
            context.evidence.record("switch", { capability: held.capability, sha });
            differences.push(...(await rehearse(context, held)));
        }
        return verdictOf(differences, [
            `${String(selected(context.capabilities).length)} capabilities`,
        ]);
    },
};
