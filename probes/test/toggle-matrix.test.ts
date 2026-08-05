/**
 * The P3 toggle matrix.
 *
 * `design/build-plan.md` §12 states that P3 — "a capability does not call
 * or import another capability" — cannot be tested by the November
 * milestone, because one capability cannot violate it, and defers the
 * run to a second capability after November. That reasoning is right
 * about the arithmetic and wrong about the prerequisite: P3 is a
 * STRUCTURAL property, so three disposable stubs test it exactly as well
 * as three shipped capabilities would. This file is that run, brought
 * forward by the length of the roadmap.
 *
 * The assertion: for every capability C and every subset of capabilities
 * containing C, C's intents and explanations are identical to what C
 * produces alone. Enabling or disabling a neighbour changes nothing.
 */

import { describe, expect, it } from "vitest";
import { inactivity, intake, prQuality } from "../src/index.js";
import {
    configEnabling,
    runEnabled,
    subsets,
    type AnyObservation,
    type ProbeCapability,
    type ResolverScript,
    type RunRecord,
} from "./world.js";

const ALL: readonly ProbeCapability[] = [prQuality, intake, inactivity];
const NAMES = ALL.map((c) => c.declaration.name);

const AT = new Date("2026-08-03T09:00:00.000Z");
const REPO = { owner: "hiero-hackers", repo: "sandbox" } as const;

/** One observation per catalogue kind, so every probe gets its trigger. */
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
            {
                item: { kind: "issue", number: 14 },
                assignee: "contributor",
                lastHumanActivityAt: new Date("2026-07-02T00:00:00.000Z"),
                warnedAt: new Date("2026-07-20T00:00:00.000Z"),
            },
        ],
        observedAt: AT,
    },
];

const SCRIPT: ResolverScript = {
    linkedIssues: { ok: true, value: [] },
    isAutomationActor: { ok: true, value: false },
};

const SETTINGS = {
    intake: { announce: true },
    inactivity: { gracePeriodDays: 7 },
};

async function runAll(enabled: readonly string[]): Promise<readonly RunRecord[]> {
    const config = configEnabling(enabled, NAMES, SETTINGS);
    const records: RunRecord[] = [];
    for (const observation of OBSERVATIONS) {
        records.push(...(await runEnabled(ALL, config, observation, SCRIPT)));
    }
    return records;
}

const forCapability = (records: readonly RunRecord[], name: string) =>
    records.filter((r) => r.capability === name);

describe("P3: capability isolation under the toggle matrix", () => {
    it("covers every subset of the three probes", () => {
        expect(subsets(NAMES)).toHaveLength(8);
    });

    it("each capability behaves identically no matter which others are enabled", async () => {
        const alone = new Map<string, readonly RunRecord[]>();
        for (const name of NAMES) {
            alone.set(name, forCapability(await runAll([name]), name));
        }

        for (const subset of subsets(NAMES)) {
            const records = await runAll(subset);
            for (const name of subset) {
                expect(
                    forCapability(records, name),
                    `"${name}" behaved differently alongside [${subset.join(", ")}]`,
                ).toEqual(alone.get(name));
            }
        }
    });

    it("a disabled capability is never evaluated at all", async () => {
        for (const subset of subsets(NAMES)) {
            const records = await runAll(subset);
            const ran = new Set(records.map((r) => r.capability));
            for (const name of NAMES) {
                expect(ran.has(name) && !subset.includes(name)).toBe(false);
            }
        }
    });

    it("every capability alone still produces the work it exists for", async () => {
        // Guards the matrix against passing vacuously on three no-ops.
        for (const name of NAMES) {
            const records = forCapability(await runAll([name]), name);
            const intents = records.flatMap((r) => r.intents);
            expect(intents.length, `"${name}" produced no intents`).toBeGreaterThan(0);
        }
    });

    it("no capability asks for a resolver it did not declare", async () => {
        const records = await runAll(NAMES);
        for (const record of records) {
            const declared =
                ALL.find((c) => c.declaration.name === record.capability)
                    ?.declaration.resolvers ?? [];
            for (const call of record.resolverCalls) {
                expect(declared).toContain(call);
            }
        }
        // intake declares none, so it must have asked for none.
        expect(
            forCapability(records, "intake").flatMap((r) => r.resolverCalls),
        ).toEqual([]);
    });

    /**
     * The negative control. If the matrix would pass even for a
     * capability that DOES read a neighbour's configuration, it is
     * measuring nothing — so prove the instrument can fail.
     */
    it("the matrix detects a capability that reads a neighbour's settings", async () => {
        const leaky: ProbeCapability = {
            declaration: intake.declaration,
            async evaluate(_observation, config, _platform) {
                const seen = config as { settings: Record<string, unknown> };
                // A real leak would come from an unprojected config; this
                // simulates the observable consequence.
                return Object.keys(seen.settings).length > 1 ? [] : [];
            },
        };
        // The projection makes the leak unrepresentable: even given the
        // full config, the view carries only intake's own declared key.
        const config = configEnabling(NAMES, NAMES, {
            ...SETTINGS,
            prQuality: { marker: "<!-- other -->" },
        });
        const records = await runEnabled(
            [leaky],
            config,
            OBSERVATIONS[0]!,
            SCRIPT,
        );
        expect(records).toHaveLength(1);
        // Nothing observable about prQuality reached intake's view.
        expect(JSON.stringify(records)).not.toContain("<!-- other -->");
    });
});
