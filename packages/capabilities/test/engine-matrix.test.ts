/**
 * P3 isolation, proven at the ENGINE level (D92 3b).
 *
 * The original toggle matrix ran the capabilities through the test harness's own
 * wiring; this one runs them through `decide()` — the composition that will
 * actually run in production. The property is the same and stronger for
 * where it is measured: for every capability C and every subset containing
 * C, C's OBSERVABLE DECISION — its approved intents and its findings — is
 * identical to C running alone. Enabling a neighbour changes nothing.
 *
 * Four records, one decision each (contracts/facts.md §4): a webhook-shaped
 * issue and pull request, and a sweep-shaped one of each. The webhook pair is
 * where `inactivity` meets `factsUnread` — it needs every group and a webhook
 * reads none — and the sweep pair is where its reminder is gated and approved.
 * What has not changed is that the claim is checked, never taken: an adapter
 * recheck cannot make an unapproved intent safe by itself (D116).
 */

import { describe, expect, it } from "vitest";
import {
    decide,
    deriveManagedMarker,
    managedMarkerPayload,
    matchesManagedComment,
    parseManagedMarker,
    type Decision,
    type Effect,
    type Externals,
    type Finding,
} from "@hiero-hackers/automation-core";
import type { Facts } from "@hiero-hackers/automation-core";
import { CAPABILITIES } from "../src/index.js";
import {
    configEnabling,
    subsets,
    sweptIssue,
    sweptPullRequest,
    webhookIssue,
    webhookPullRequest,
} from "./world.js";

// Derived, not listed: a capability joins the matrix by joining the registry.
const ALL = CAPABILITIES;
const NAMES = CAPABILITIES.map((capability) => capability.declaration.name);

const RECORDS: readonly Facts[] = [
    webhookIssue(),
    webhookPullRequest(),
    sweptIssue({
        assignees: [
            {
                login: "contributor",
                assignedAt: new Date("2026-07-01T00:00:00.000Z"),
                lastWorkingAt: null,
            },
        ],
    }),
    // One of each kind since D143, so the vacuity control and the identity
    // block exercise both ladders rather than only the issue one. The pull
    // request is a stale draft the repository never opted into reaping, which
    // is the silent branch — the issue record above is what makes the sweep do
    // visible work.
    sweptPullRequest({
        assignees: [
            {
                login: "contributor",
                assignedAt: new Date("2026-07-01T00:00:00.000Z"),
                lastWorkingAt: null,
            },
        ],
    }),
];

const SETTINGS = {
    intake: { announce: true },
    inactivity: { issues: { enabled: true } },
};

const externals: Externals = {
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
    readonly approved: readonly Effect[];
    readonly findings: readonly Finding[];
}
const capabilityOf = (f: Finding): string | null =>
    f.subject.kind === "capability" || f.subject.kind === "item" || f.subject.kind === "effect"
        ? f.subject.capability
        : null;

function sliceFor(decisions: readonly Decision[], name: string): Slice {
    return {
        approved: decisions.flatMap((d) =>
            d.approved.filter((effect) => effect.intent.capability === name),
        ),
        findings: decisions.flatMap((d) =>
            d.report.findings.filter((f) => capabilityOf(f) === name),
        ),
    };
}

async function runAll(enabled: readonly string[]): Promise<readonly Decision[]> {
    const config = configEnabling(enabled, NAMES, SETTINGS);
    const decisions: Decision[] = [];
    for (const facts of RECORDS) {
        decisions.push(await decide({ kind: "facts", facts }, config, ALL, externals));
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
        /**
         * Both halves of facts.md §4 in one list, in record order: the two
         * webhook records are skipped because inactivity needs groups a
         * webhook does not read, and the swept issue's reminder is gated and
         * approved. The swept pull request is silent because this repository
         * never enabled that ladder.
         */
        const staleAlone = sliceFor(await runAll(["inactivity"]), "inactivity");
        expect(staleAlone.approved.length).toBeGreaterThan(0);
        expect(staleAlone.findings.map((finding) => finding.code)).toEqual([
            "factsUnread",
            "factsUnread",
            "capabilityExplained",
            "applied",
        ]);
    });
});

/**
 * The cross-layer half of prQuality's conflict claim. The capability reads no
 * position, so nothing in its `capability.ts` stops a conflicted pull request — and
 * for a month its docstring said one "still gets its comment". The engine is
 * where that is settled: `deriveWorld` establishes no precondition from a
 * conflicted projection, so the preflight refuses before any rule runs.
 */
describe("prQuality on a conflicted pull request", () => {
    const conflicted = webhookPullRequest({
        position: {
            kind: "conflict",
            positions: ["needsReview", "readyToMerge"],
            blocked: false,
            closedBy: null,
            ignored: [],
        },
    });

    it("refuses preconditionStale and approves nothing", async () => {
        const decision = await decide(
            { kind: "facts", facts: conflicted },
            configEnabling(["prQuality"], NAMES, SETTINGS),
            ALL,
            externals,
        );

        expect(decision.approved).toEqual([]);
        expect(decision.report.findings.map((finding) => finding.code)).toEqual([
            "preconditionStale",
        ]);
    });

    /**
     * Merged counts as closed, and prQuality declines before the resolver
     * rather than at the gate — the `itemClosed` rule changed nothing here,
     * which is the point of asserting it.
     */
    it("says nothing at all about a merged pull request", async () => {
        const merged = webhookPullRequest({
            position: {
                kind: "position",
                state: { meaning: null, blocked: false, closedBy: "merged" },
                ignored: [],
            },
        });
        const decision = await decide(
            { kind: "facts", facts: merged },
            configEnabling(["prQuality"], NAMES, SETTINGS),
            ALL,
            externals,
        );

        expect(decision.approved).toEqual([]);
        expect(decision.report.findings).toEqual([]);
    });
});

/**
 * D125's ownership split, measured where it is decided: no capability writes a
 * marker, and every managed comment the engine approves carries one anyway.
 * `inactivity` is here now: a sweep-shaped record makes its reminder
 * approvable, so the warning earns the identity a warning is found again by.
 */
describe("managed-comment identity is minted by the platform", () => {
    const approvedComments = async () => {
        const effects = (await runAll(NAMES)).flatMap((decision) => decision.approved);
        return effects.filter((effect) => effect.intent.operation === "postManagedComment");
    };

    it("marks every comment the four records earn, and none of the labels", async () => {
        const comments = await approvedComments();
        /**
         * Record order, and a capability sees every record of a kind it
         * declared: intake and prQuality read the sweep-shaped pair too, since
         * a sweep reads a superset of what a webhook does.
         */
        expect(
            comments.map((effect) => ({
                capability: effect.intent.capability,
                item: effect.intent.item.number,
                kind: effect.managedComment?.identity.kind,
                topic: effect.managedComment?.identity.topic,
            })),
        ).toEqual([
            { capability: "intake", item: 11, kind: "notice", topic: "" },
            { capability: "prQuality", item: 12, kind: "summary", topic: "" },
            { capability: "intake", item: 13, kind: "notice", topic: "" },
            // `inactivity` is the one design that needs the discriminator: the
            // warning is about ONE assignee's clock (D145).
            { capability: "inactivity", item: 13, kind: "warning", topic: "contributor" },
            { capability: "prQuality", item: 14, kind: "summary", topic: "" },
        ]);
        // The identity is minted from the intent's OWN fields, never chosen —
        // and it names the ITEM and the purpose, never the occasion.
        for (const effect of comments) {
            const identity = effect.managedComment!.identity;
            expect(identity.capability).toBe(effect.intent.capability);
            expect(identity.item).toEqual(effect.intent.item);
            expect(deriveManagedMarker(identity)).not.toContain(
                effect.intent.cause.observedAt.toISOString(),
            );
        }

        // The label intake also asks for is the control: an operation that
        // posts nothing is handed no identity to post it under.
        const labels = (await runAll(NAMES))
            .flatMap((decision) => decision.approved)
            .filter((effect) => effect.intent.operation === "applyMappedLabel");
        expect(labels.map((effect) => effect.managedComment)).toEqual([null, null]);
    });

    it("publishes each identity as the marker that identity derives", async () => {
        for (const effect of await approvedComments()) {
            const managed = effect.managedComment!;
            expect(managed.marker).toBe(deriveManagedMarker(managed.identity));
            expect(parseManagedMarker(managed.marker)).toEqual({
                recognized: {
                    schemaVersion: 2,
                    capability: managed.identity.capability,
                    kind: managed.identity.kind,
                    subject: expect.stringMatching(/^[0-9a-f]{16}$/),
                },
            });
        }
    });

    /** The attack, at this scale: the App's own marker, in someone else's comment. */
    it("never recognises a capability's marker under another author", async () => {
        for (const effect of await approvedComments()) {
            const managed = effect.managedComment!;
            const published = managedMarkerPayload(managed.identity);
            expect(
                matchesManagedComment({ body: managed.marker, authoredByApp: true }, published),
            ).toEqual({ matches: true });
            expect(
                matchesManagedComment({ body: managed.marker, authoredByApp: false }, published),
            ).toEqual({ matches: false, why: "notAppAuthored" });
        }
    });
});

describe("intake conflict behavior", () => {
    it("reports a conflicted item in dry-run without approving a repair", async () => {
        const config = {
            ...configEnabling(["intake"], NAMES, SETTINGS),
            mode: "dry-run" as const,
        };
        const facts = webhookIssue({
            position: {
                kind: "conflict",
                positions: ["ready", "inProgress"],
                blocked: false,
                closedBy: null,
                ignored: [],
            },
        });

        const decision = await decide({ kind: "facts", facts }, config, ALL, externals);

        expect(decision.approved).toEqual([]);
        expect(decision.report.findings.map((finding) => finding.code)).toEqual([
            "capabilityExplained",
        ]);
        expect(
            decision.report.findings
                .filter((finding) => finding.code === "capabilityExplained")
                .map((finding) => finding.summary),
        ).toContain("Skipped: the item holds more than one workflow position.");
    });
});
