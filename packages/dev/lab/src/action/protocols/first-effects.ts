/**
 * Protocol 9.2: the first effects from an armed run: the writes land once, a re-run writes
 * nothing, an unarmed or disabled workflow writes nothing, a maintainer's reversal is not fought.
 */

import { TRIAGE_LABEL } from "../cases.js";
import { configOf } from "../configs.js";
import { actionEventsSince, rowDifferences } from "../judge.js";
import { ARM_VARIABLE } from "../sandbox.js";
import {
    actionWrites,
    appliedIn,
    BOT,
    codesOf,
    issueRef,
    verdictOf,
    writeCountDifferences,
    type Context,
    type Protocol,
} from "./kit.js";

/** A disabled workflow raises nothing; this long without a run is the evidence. */
const DISABLED_WAIT_MS = 75_000;

/** The maintainer deletes the App's comment and its label; two sweeps must not put them back. */
async function reverse(
    context: Context,
    first: number,
    differences: string[],
    notes: string[],
): Promise<void> {
    const { person, watch } = context;
    const item = issueRef(first);
    const bot = (await person.commentsOf(first)).filter((comment) => comment.login === BOT);
    for (const comment of bot) await person.deleteComment(comment.id);
    const { since } = await person.setLabels(first, []);
    const settled = await watch.settle(since, ["issues"]);
    if ("failed" in settled) {
        differences.push(`the unlabeled run: ${settled.failed}`);
        return;
    }
    const read = await watch.read(settled.runs);
    differences.push(...rowDifferences(item, [], read.rows).map((line) => `reversal: ${line}`));
    for (let sweep = 1; sweep <= 2; sweep += 1) {
        const at = await context.sandbox.dispatch();
        const swept = await watch.settle(at, ["workflow_dispatch"]);
        if ("failed" in swept) {
            differences.push(`sweep ${String(sweep)}: ${swept.failed}`);
            return;
        }
        await watch.read(swept.runs, `-sweep${String(sweep)}`);
    }
    differences.push(...(await actionWrites(context, item, since, {})));
    notes.push(`reversal: ${String(bot.length)} comment deleted, label removed, not re-added`);
}

export const firstEffects: Protocol = {
    id: "9.2",
    slug: "first-effects-as-an-action",
    writes: true,
    long: false,
    async run(context) {
        const { sandbox, person, watch, tag } = context;
        const differences: string[] = [];
        const notes: string[] = [];
        const texts: string[] = [];
        await sandbox.prepare();
        await sandbox.arm(configOf("active", ["triageQueue"]), `lab ${tag}: 9.2 armed`);

        const one = await person.open(`lab-${tag}-9.2-armed`);
        const first = issueRef(one.number);
        const settled = await watch.settle(one.since, ["issues"]);
        if ("failed" in settled) return verdictOf([`the armed open: ${settled.failed}`]);
        const run = settled.runs[0];
        const read = await watch.read(settled.runs);
        texts.push(...read.texts);
        differences.push(
            ...(await actionWrites(context, first, one.since, { labeled: 1, commented: 1 })),
        );
        const comments = (await person.commentsOf(one.number)).filter((c) => c.login === BOT);
        if (comments.length !== 1)
            differences.push(`${String(comments.length)} comments by ${BOT}, expected 1`);
        if (!(await person.labelsOf(one.number)).includes(TRIAGE_LABEL)) {
            differences.push(`the ${TRIAGE_LABEL} label is absent`);
        }
        notes.push(`armed open: ${codesOf(read.rows).join("; ")}`);

        if (run !== undefined) {
            const since = await watch.rerun(run.id);
            const again = await watch.read([run], "-attempt2");
            texts.push(...again.texts);
            differences.push(
                ...(await actionWrites(context, first, since, {})).map((line) => `re-run: ${line}`),
            );
            notes.push(`re-run: ${codesOf(again.rows).join("; ")}`);
        }

        await sandbox.setVariable(ARM_VARIABLE, "false");
        const two = await person.open(`lab-${tag}-9.2-unarmed`);
        const unarmed = await watch.settle(two.since, ["issues"]);
        if ("failed" in unarmed) differences.push(`the unarmed open: ${unarmed.failed}`);
        else {
            texts.push(...(await watch.read(unarmed.runs)).texts);
            differences.push(...(await actionWrites(context, issueRef(two.number), two.since, {})));
        }
        await sandbox.setVariable(ARM_VARIABLE, "true");

        await sandbox.setWorkflow(false);
        const three = await person.open(`lab-${tag}-9.2-disabled`);
        const stray = await watch.quiet(three.since, ["issues"], DISABLED_WAIT_MS);
        if (stray.length > 0)
            differences.push(`${String(stray.length)} runs while the workflow was disabled`);
        differences.push(...(await actionWrites(context, issueRef(three.number), three.since, {})));
        await sandbox.setWorkflow(true);

        // Counted before the reversal: a deleted comment leaves the timeline.
        let written = 0;
        for (const number of [one.number, two.number, three.number]) {
            const events = await watch.timeline(issueRef(number));
            written += actionEventsSince(events, one.since).length;
        }
        differences.push(...writeCountDifferences(appliedIn(texts), written));

        if (context.human) await reverse(context, one.number, differences, notes);
        else notes.push("reversal skipped: it needs a person's token");
        return verdictOf(differences, notes);
    },
};
