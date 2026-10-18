/**
 * Protocol 9.3: a warning honoured across runs. Three assigned issues are warned by one sweep;
 * a sweep inside the grace refuses the act, `/working` cancels one, a deleted warning is
 * re-warned, and a sweep after the grace acts on the third. Every sweep is dispatched by hand.
 */

import { ladderConfig, SHORT_GRACE_MS } from "../configs.js";
import { actionEventsSince, countsOf } from "../judge.js";
import {
    actionWrites,
    BOT,
    botComments,
    issueRef,
    sweepOnce,
    verdictOf,
    type Protocol,
} from "./kit.js";

/** Between the warning and the sweep that must refuse. */
const INSIDE_MS = 5 * 60_000;

/** Past the grace, so the sweep that acts is not early. */
const MARGIN_MS = 5 * 60_000;

/** Sweeps tried after the grace before the act is called absent. */
const AFTER_SWEEPS = 3;

const BETWEEN_MS = 10 * 60_000;

export const grace: Protocol = {
    id: "9.3",
    slug: "grace-across-runs",
    writes: true,
    long: true,
    async run(context) {
        const { sandbox, person, owner, tag } = context;
        const differences: string[] = [];
        const notes: string[] = [];
        await sandbox.arm(ladderConfig("active"), `lab ${tag}: 9.3 armed`);

        const fixtures = [];
        for (const name of ["acts", "cancelled", "deleted"]) {
            const made = await person.open(`lab-${tag}-9.3-${name}`);
            await person.assign(made.number, owner);
            fixtures.push({ name, number: made.number, since: made.since });
        }
        const [acts, cancelled, deleted] = fixtures;
        if (acts === undefined || cancelled === undefined || deleted === undefined)
            return verdictOf(["no fixtures"]);

        const warnedAt = Date.now();
        const warnedIso = new Date(warnedAt).toISOString();
        const warning = await sweepOnce(context, "-warn");
        for (const fixture of fixtures) {
            const warned = await botComments(context, fixture.number);
            if (warned.length === 0)
                differences.push(`${fixture.name}: no warning after the first sweep`);
            notes.push(`${fixture.name}: warning ${warned[0]?.body.slice(0, 160) ?? "absent"}`);
            differences.push(
                ...(await actionWrites(context, issueRef(fixture.number), fixture.since, {
                    commented: warned.length,
                })),
            );
        }
        if (warning === "") differences.push("the warning sweep logged nothing");

        const working = await person.comment(cancelled.number, "/working");
        let removedAt = warnedIso;
        for (const comment of await botComments(context, deleted.number)) {
            removedAt = (await person.deleteComment(comment.id)).since;
        }

        await context.sleep(INSIDE_MS);
        const inside = await sweepOnce(context, "-inside");
        if (!inside.includes("graceRunning"))
            differences.push("acts: no graceRunning inside the grace");
        const early = actionEventsSince(
            await context.watch.timeline(issueRef(acts.number)),
            warnedIso,
        );
        if (countsOf(early)["unassigned"] !== undefined)
            differences.push("acts: unassigned inside the grace");

        await context.sleep(Math.max(0, warnedAt + SHORT_GRACE_MS + MARGIN_MS - Date.now()));
        let acted = false;
        for (let sweep = 1; sweep <= AFTER_SWEEPS && !acted; sweep += 1) {
            await sweepOnce(context, `-after${String(sweep)}`);
            const events = await context.watch.timeline(issueRef(acts.number));
            acted = events.some((event) => event.event === "unassigned" && event.actor === BOT);
            if (!acted && sweep < AFTER_SWEEPS) await context.sleep(BETWEEN_MS);
        }
        if (!acted) differences.push("acts: no unassigned after the grace");

        const kept = actionEventsSince(
            await context.watch.timeline(issueRef(cancelled.number)),
            working.since,
        );
        if (countsOf(kept)["unassigned"] !== undefined)
            differences.push("cancelled: unassigned after /working");
        const rewarned = actionEventsSince(
            await context.watch.timeline(issueRef(deleted.number)),
            removedAt,
        );
        const counts = countsOf(rewarned);
        if ((counts["commented"] ?? 0) < 1)
            differences.push("deleted: no new warning after the deletion");
        if (counts["unassigned"] !== undefined)
            differences.push("deleted: unassigned instead of a new warning");
        return verdictOf(differences, notes);
    },
};
