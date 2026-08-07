/**
 * P3 isolation, proven at the ENGINE level (D92 3b).
 *
 * The original toggle matrix ran the probes through the test harness's own
 * wiring; this one runs them through `decide()` — the composition that will
 * actually run in production. The property is the same and stronger for
 * where it is measured: for every capability C and every subset containing
 * C, C's OBSERVABLE DECISION — its approved intents and its findings — is
 * identical to C running alone. Enabling a neighbour changes nothing.
 *
 * One honest asymmetry against the old matrix, documented not hidden: under
 * the engine's derived preconditions, `inactivity`'s intents (which claim
 * `closed: false` on the unprojected `staleItemsDue`) are refused
 * `preconditionStale` — the planner's per-intent recheck used to vouch for
 * them. That tension is 3(c)'s agenda; here it holds for every subset
 * equally, so isolation is still fully measured.
 */

import { describe, expect, it } from "vitest";
import {
    decide,
    type AnyIntent,
    type DecideExternals,
    type Decision,
    type EngineCapability,
    type Finding,
} from "@hiero-hackers/automation-core";
import { inactivity, intake, prQuality } from "../src/index.js";
import { configEnabling, subsets, type AnyObservation } from "./world.js";

const ALL = [prQuality, intake, inactivity].map(
    (c) => c as unknown as EngineCapability,
);
const NAMES = ["prQuality", "intake", "inactivity"];

const AT = new Date("2026-08-03T09:00:00.000Z");
const REPO = { owner: "hiero-hackers", repo: "sandbox" } as const;

const OBSERVATIONS: readonly AnyObservation[] = [
    {
        kind: "issueUpdated",
        repository: REPO,
        item: { kind: "issue", number: 11 },
        position: {
            kind: "position",
            state: { meaning: null, blocked: false, closedBy: null },
            ignored: [],
        },
        observedAt: AT,
    },
    {
        kind: "pullRequestUpdated",
        repository: REPO,
        item: { kind: "pullRequest", number: 12 },
        position: {
            kind: "position",
            state: { meaning: null, blocked: false, closedBy: null },
            ignored: [],
        },
        observedAt: AT,
    },
    {
        kind: "staleItemsDue",
        repository: REPO,
        items: [
            {
                item: { kind: "issue", number: 13 },
                assignee: "contributor",
                lastHumanActivityAt: new Date("2026-07-01T00:00:00.000Z"),
                warnedAt: null,
            },
        ],
        observedAt: AT,
    },
];

const SETTINGS = {
    intake: { announce: true },
    inactivity: { gracePeriodDays: 7 },
    prQuality: { marker: "<!-- probe:prq -->" },
};

const externals: DecideExternals = {
    killSwitchActive: false,
    installationGrants: ["issues:write"],
    latestHumanChangeAt: () => null,
    resolve: async (query) =>
        query === "linkedIssues"
            ? ({ ok: true, value: [] } as never)
            : ({ ok: true, value: false } as never),
};

/** A capability's observable share of a decision. */
interface Slice {
    readonly approved: readonly AnyIntent[];
    readonly findings: readonly Finding[];
}
const capabilityOf = (f: Finding): string | null =>
    f.subject.kind === "capability" ||
    f.subject.kind === "item" ||
    f.subject.kind === "effect"
        ? f.subject.capability
        : null;

function sliceFor(decisions: readonly Decision[], name: string): Slice {
    return {
        approved: decisions.flatMap((d) =>
            d.approved.filter((i) => i.capability === name),
        ),
        findings: decisions.flatMap((d) =>
            d.report.findings.filter((f) => capabilityOf(f) === name),
        ),
    };
}

async function runAll(enabled: readonly string[]): Promise<readonly Decision[]> {
    const config = configEnabling(enabled, NAMES, SETTINGS);
    const decisions: Decision[] = [];
    for (const observation of OBSERVATIONS) {
        decisions.push(
            await decide({ kind: "observation", observation }, config, ALL, externals),
        );
    }
    return decisions;
}

describe("P3 through the engine", () => {
    it("each capability's decision is identical no matter which others are enabled", async () => {
        const alone = new Map<string, Slice>();
        for (const name of NAMES) {
            alone.set(name, sliceFor(await runAll([name]), name));
        }
        for (const subset of subsets(NAMES)) {
            const decisions = await runAll(subset);
            for (const name of subset) {
                expect(
                    sliceFor(decisions, name),
                    `"${name}" decided differently alongside [${subset.join(", ")}]`,
                ).toEqual(alone.get(name));
            }
        }
    });

    it("a disabled capability leaves no trace in any decision", async () => {
        for (const subset of subsets(NAMES)) {
            const decisions = await runAll(subset);
            for (const name of NAMES) {
                if (subset.includes(name)) continue;
                expect(sliceFor(decisions, name)).toEqual({
                    approved: [],
                    findings: [],
                });
            }
        }
    });

    it("the matrix is not vacuous: alone-runs do real, distinguishable work", async () => {
        const intakeAlone = sliceFor(await runAll(["intake"]), "intake");
        expect(intakeAlone.approved.length).toBeGreaterThan(0);
        const prAlone = sliceFor(await runAll(["prQuality"]), "prQuality");
        expect(prAlone.approved.length).toBeGreaterThan(0);
        // inactivity's share is refusals under the engine's derived
        // preconditions — nonzero, and the 3(c) tension made visible.
        const staleAlone = sliceFor(await runAll(["inactivity"]), "inactivity");
        expect(staleAlone.approved).toEqual([]);
        expect(
            staleAlone.findings.some((f) => f.code === "preconditionStale"),
        ).toBe(true);
    });
});
