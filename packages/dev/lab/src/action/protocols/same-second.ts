/**
 * Protocol 9.4: two label changes on a locked issue, in one request, one second and five
 * seconds apart: one unlock lands on GitHub, the later run is idempotent, no run that mattered
 * is lost to the concurrency group.
 */

import { READY_LABEL, lockingConfig } from "../configs.js";
import { TRIAGE_LABEL } from "../cases.js";
import { codesOf, issueRef, actionWrites, verdictOf, type Context, type Protocol } from "./kit.js";

/** The gap between the two changes, one repetition each. */
const GAPS_MS = [0, 1_000, 5_000];

async function repetition(
    context: Context,
    gap: number,
    differences: string[],
    notes: string[],
): Promise<void> {
    const { person, watch, tag } = context;
    const name = `rep${String(gap / 1000)}s`;
    const fixture = await person.open(`lab-${tag}-9.4-${name}`);
    const item = issueRef(fixture.number);
    const opened = await watch.settle(fixture.since, ["issues"]);
    if ("failed" in opened) {
        differences.push(`${name}: the opening run: ${opened.failed}`);
        return;
    }
    await watch.read(opened.runs);
    if (
        !(await person.lockedOf(fixture.number)) ||
        !(await person.labelsOf(fixture.number)).includes(TRIAGE_LABEL)
    ) {
        differences.push(`${name}: the fixture is not locked and awaiting triage`);
        return;
    }
    const change = await person.setLabels(fixture.number, gap === 0 ? [READY_LABEL] : []);
    if (gap > 0) {
        await context.sleep(gap);
        await person.setLabels(fixture.number, [READY_LABEL]);
    }
    const settled = await watch.settle(change.since, ["issues"], ["cancelled"]);
    if ("failed" in settled) {
        differences.push(`${name}: ${settled.failed}`);
        return;
    }
    const read = await watch.read(settled.runs);
    differences.push(
        ...(await actionWrites(context, item, change.since, { unlocked: 1, commented: 1 })).map(
            (line) => `${name}: ${line}`,
        ),
    );
    if (await person.lockedOf(fixture.number))
        differences.push(`${name}: the issue is still locked`);
    notes.push(
        `${name}: ${String(settled.runs.length)} runs, ${String(settled.cancelled.length)} cancelled by the group; ${codesOf(read.rows).join("; ")}`,
    );
}

export const sameSecond: Protocol = {
    id: "9.4",
    slug: "same-second-events",
    writes: true,
    long: false,
    async run(context) {
        const { sandbox, tag } = context;
        const differences: string[] = [];
        const notes: string[] = [];
        await sandbox.prepare();
        await sandbox.ensureLabel(READY_LABEL);
        await sandbox.arm(lockingConfig("active"), `lab ${tag}: 9.4 armed`);
        for (const gap of GAPS_MS) await repetition(context, gap, differences, notes);
        return verdictOf(differences, notes);
    },
};
