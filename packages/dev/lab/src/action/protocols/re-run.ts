/**
 * Protocol 9.6: a run re-run after a person changed what it wrote: the facts are read live,
 * the stale cause is refused as `newerHumanChange`, and nothing is written. A second fixture
 * no one touched is re-run beside it.
 */

import { configOf } from "../configs.js";
import {
    actionWrites,
    BOT,
    codesOf,
    issueRef,
    skipped,
    verdictOf,
    type Context,
    type Protocol,
} from "./kit.js";

/** Opens a fixture, lets the armed run write, and answers the run that did. */
async function written(
    context: Context,
    name: string,
): Promise<{ number: number; run: number } | string> {
    const { person, watch } = context;
    const fixture = await person.open(`lab-${context.tag}-9.6-${name}`);
    const settled = await watch.settle(fixture.since, ["issues"]);
    if ("failed" in settled) return `${name}: ${settled.failed}`;
    const run = settled.runs[0];
    await watch.read(settled.runs);
    return run === undefined ? `${name}: no run` : { number: fixture.number, run: run.id };
}

export const reRun: Protocol = {
    id: "9.6",
    slug: "re-run-of-an-old-run",
    writes: true,
    long: false,
    async run(context) {
        if (!context.human) return skipped("a person's change needs a person's token");
        const { sandbox, person, watch, tag } = context;
        const differences: string[] = [];
        const notes = ["the re-run is minutes old, not a day"];
        await sandbox.prepare();
        await sandbox.arm(configOf("active", ["triageQueue"]), `lab ${tag}: 9.6 armed`);

        const touched = await written(context, "touched");
        const untouched = await written(context, "untouched");
        if (typeof touched === "string" || typeof untouched === "string") {
            return verdictOf(
                [
                    typeof touched === "string" ? touched : "",
                    typeof untouched === "string" ? untouched : "",
                ].filter(Boolean),
            );
        }

        for (const comment of (await person.commentsOf(touched.number)).filter(
            (c) => c.login === BOT,
        )) {
            await person.deleteComment(comment.id);
        }
        await person.setLabels(touched.number, []);

        for (const [name, held] of [
            ["touched", touched],
            ["untouched", untouched],
        ] as const) {
            const since = await watch.rerun(held.run);
            const again = await watch.read([{ id: held.run }], "-attempt2");
            differences.push(
                ...(await actionWrites(context, issueRef(held.number), since, {})).map(
                    (line) => `${name}: ${line}`,
                ),
            );
            const refused = again.texts.some((text) => text.includes("newerHumanChange"));
            if (name === "touched" && !refused)
                differences.push("touched: no newerHumanChange in the re-run");
            notes.push(`${name}: ${codesOf(again.rows).join("; ")}`);
        }
        return verdictOf(differences, notes);
    },
};
