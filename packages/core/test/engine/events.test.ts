/**
 * The normalizer, tested against what GitHub actually sent.
 *
 * The payloads live in the testkit now — two packages needed them, which is
 * this repository's admission rule for shared test support — and they reach
 * this file through its export rather than a path, so they travel into
 * Stryker's sandbox with the dependency. What a delivery BECOMES is this
 * file's subject.
 *
 * Every capture is a real delivery from the 2026-08-07 capture session
 * (protocol 7.1), scrubbed and human-reviewed. No payload here was written
 * by hand, and that is the point: the assumptions worth testing are the ones
 * GitHub gets to falsify.
 */

import { describe, expect, it } from "vitest";
import { WEBHOOK_CAPTURES, capture } from "@hiero-hackers/automation-testkit";
import { normalizeDelivery, type RepositoryConfig } from "../../src/index.js";
import { configWith } from "../config/builders.js";

const fixture = (name: string): unknown => capture(name).json();

/** The capture-session sandbox's mapping — matches the labels provoked. */
const config = configWith({
    labels: {
        awaitingTriage: "status: triage",
        ready: "status: ready",
        needsReview: "status: needs review",
        blocked: "status: blocked",
    },
});

const observed = (name: string, cfg: RepositoryConfig = config) => {
    const subject = capture(name);
    const result = normalizeDelivery(subject.event, subject.json(), cfg);
    expect(result.kind, `${name} should normalize`).toBe("observation");
    if (result.kind !== "observation") throw new Error("unreachable");
    return result.observation;
};

describe("every captured fixture normalizes", () => {
    it("the capture set is present and non-empty", () => {
        // Vacuity guard: an empty set would pass the `it.each` below in
        // silence, which is the whole reason this assertion exists.
        expect(WEBHOOK_CAPTURES.length).toBeGreaterThanOrEqual(5);
    });

    it.each(WEBHOOK_CAPTURES.map((subject) => [subject.name, subject] as const))(
        "%s",
        (_name, subject) => {
            const result = normalizeDelivery(subject.event, subject.json(), config);
            expect(result.kind).toBe("observation");
        },
    );
});

describe("issues, through the real payloads", () => {
    it("opened: no position, open, unpaused", () => {
        const o = observed("issues.opened.json");
        expect(o.kind).toBe("issueUpdated");
        /**
         * The repository, read literally off the capture rather than
         * compared against another reading of it. Everything downstream —
         * the report's subject, the idempotency key's first two fields —
         * takes this pair on trust, and every existing assertion about it
         * derived both sides from this same function (§9's standing rule:
         * a constant compared against itself proves nothing).
         */
        expect(o.repository).toEqual({ owner: "scrubbed-1", repo: "scrubbed-2" });
        expect(o.item).toEqual({ kind: "issue", number: 164 });
        expect(o.position).toEqual({
            kind: "position",
            state: { meaning: null, blocked: false, closedBy: null },
            ignored: [],
        });
        expect(o.observedAt.toISOString()).toBe("2026-08-06T23:09:54.000Z");
    });

    it("labeled: the mapped label becomes its meaning", () => {
        const o = observed("issues.labeled.json");
        expect(o.position).toMatchObject({
            kind: "position",
            state: { meaning: "awaitingTriage" },
        });
    });

    /**
     * D35, on a real payload: closing did not strip the position label,
     * and the projection keeps BOTH facts — closed, and still at triage.
     * A normalizer that flattened closure into "no position" would have
     * erased exactly what reopen needs.
     */
    it("closed: closure recorded, position preserved", () => {
        const o = observed("issues.closed.json");
        expect(o.position).toEqual({
            kind: "position",
            state: {
                meaning: "awaitingTriage",
                blocked: false,
                closedBy: "closedByHuman",
            },
            ignored: [],
        });
    });

    it("an unmapped repository sees the same delivery as meaningless", () => {
        const bare = configWith();
        const o = observed("issues.labeled.json", bare);
        expect(o.position).toMatchObject({
            kind: "position",
            state: { meaning: null },
        });
    });
});

describe("pull requests, through the real payloads", () => {
    it("opened: no position, open", () => {
        const o = observed("pull_request.opened.json");
        expect(o.kind).toBe("pullRequestUpdated");
        expect(o.item).toEqual({ kind: "pullRequest", number: 165 });
        expect(o.position).toMatchObject({
            kind: "position",
            state: { meaning: null, closedBy: null },
        });
    });

    it("closed-by-merge reads as merged, not closedByHuman (D47)", () => {
        const o = observed("pull_request.closed.json");
        expect(o.position).toMatchObject({
            kind: "position",
            state: { closedBy: "merged" },
        });
    });

    /**
     * The other closed pull request. Both captures are decided by `merged`
     * alone — one true, one absent-and-open — so the branch that reads
     * `state` on a pull request had never run, and D47's whole point is that
     * the two closures stay distinguishable: progression credits a merge and
     * must not credit an abandonment.
     */
    it("closed WITHOUT merging reads as closedByHuman, not merged (D47)", () => {
        const abandoned = fixture("pull_request.closed.json") as {
            pull_request: { merged: boolean; state: string };
        };
        abandoned.pull_request.merged = false;
        abandoned.pull_request.state = "closed";
        const result = normalizeDelivery("pull_request", abandoned, config);
        expect(result.kind).toBe("observation");
        if (result.kind !== "observation") return;
        expect(result.observation.position).toMatchObject({
            kind: "position",
            state: { closedBy: "closedByHuman" },
        });
    });
});

describe("shapes derived from the real ones", () => {
    /** Clone a fixture and edit its label set — shape stays GitHub's. */
    const withLabels = (names: readonly string[]): unknown => {
        const d = fixture("issues.labeled.json") as { issue: { labels: unknown[] } };
        d.issue.labels = names.map((name) => ({ name }));
        return d;
    };

    it("two own-flow positions project as a conflict, not a repair", () => {
        const result = normalizeDelivery(
            "issues",
            withLabels(["status: triage", "status: ready"]),
            config,
        );
        expect(result.kind).toBe("observation");
        if (result.kind !== "observation") return;
        expect(result.observation.position).toMatchObject({
            kind: "conflict",
            positions: ["awaitingTriage", "ready"],
        });
    });

    it("a cross-flow label is ignored diagnostics, never a conflict (D35)", () => {
        const result = normalizeDelivery(
            "issues",
            withLabels(["status: triage", "status: needs review"]),
            config,
        );
        expect(result.kind).toBe("observation");
        if (result.kind !== "observation") return;
        expect(result.observation.position).toMatchObject({
            kind: "position",
            state: { meaning: "awaitingTriage" },
            ignored: ["needsReview"],
        });
    });

    it("the blocked label pauses without occupying a position (D28)", () => {
        const result = normalizeDelivery("issues", withLabels(["status: blocked"]), config);
        expect(result.kind).toBe("observation");
        if (result.kind !== "observation") return;
        expect(result.observation.position).toMatchObject({
            kind: "position",
            state: { meaning: null, blocked: true },
        });
    });
});

describe("what the normalizer refuses, and how", () => {
    it("a foreign event is ignored — the system working, not failing", () => {
        expect(normalizeDelivery("push", {}, config)).toEqual({
            kind: "ignored",
            event: "push",
        });
        expect(normalizeDelivery("ping", { zen: "ok" }, config)).toMatchObject({
            kind: "ignored",
        });
    });

    /**
     * One case per code, plus shape VARIANTS sharing a code: a mutant that
     * disables an inner guard makes the variant crash instead of answering
     * `malformed`, so every guard is load-bearing even where codes coincide.
     */
    it.each([
        ["payloadNotObject", "issues", null],
        ["repositoryUnreadable", "issues", {}],
        ["repositoryUnreadable", "issues", { repository: { name: "r" } }],
        ["repositoryUnreadable", "issues", { repository: { owner: { login: 42 }, name: "r" } }],
        ["repositoryUnreadable", "issues", { repository: { owner: { login: "o" }, name: 42 } }],
        ["itemMissing", "issues", { repository: { owner: { login: "o" }, name: "r" } }],
        [
            "numberMissing",
            "issues",
            { repository: { owner: { login: "o" }, name: "r" }, issue: {} },
        ],
        [
            "labelsUnreadable",
            "issues",
            {
                repository: { owner: { login: "o" }, name: "r" },
                issue: { number: 1, labels: [{ nope: true }], updated_at: "2026-08-07T00:00:00Z" },
            },
        ],
        [
            "labelsUnreadable",
            "issues",
            {
                repository: { owner: { login: "o" }, name: "r" },
                issue: { number: 1, labels: "nope", updated_at: "2026-08-07T00:00:00Z" },
            },
        ],
        // No `labels` key at all. The array guard is what turns this into a
        // verdict; without it the walk is over `undefined` and the shell
        // gets an exception where the contract promises a result.
        [
            "labelsUnreadable",
            "issues",
            {
                repository: { owner: { login: "o" }, name: "r" },
                issue: { number: 1, updated_at: "2026-08-07T00:00:00Z" },
            },
        ],
        [
            "timestampUnreadable",
            "issues",
            {
                repository: { owner: { login: "o" }, name: "r" },
                issue: { number: 1, labels: [], updated_at: "not a date" },
            },
        ],
        [
            "timestampUnreadable",
            "issues",
            {
                repository: { owner: { login: "o" }, name: "r" },
                issue: { number: 1, labels: [], updated_at: 42 },
            },
        ],
        [
            "mergedMissing",
            "pull_request",
            {
                repository: { owner: { login: "o" }, name: "r" },
                pull_request: { number: 1, labels: [], updated_at: "2026-08-07T00:00:00Z" },
            },
        ],
    ] as const)("malformed: %s", (code, event, payload) => {
        const result = normalizeDelivery(event, payload, config);
        expect(result.kind).toBe("malformed");
        if (result.kind !== "malformed") return;
        expect(result.code).toBe(code);
        expect(result.detail.length).toBeGreaterThan(0);
    });
});
