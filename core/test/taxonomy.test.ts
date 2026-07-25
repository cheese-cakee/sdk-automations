import { describe, it, expect } from "vitest";
import {
    ISSUE_MEANINGS,
    PR_MEANINGS,
    canTransitionIssue,
    canTransitionPr,
    applyTransition,
    type IssueMeaning,
    type PrMeaning,
    type TransitionCause,
    type WorkItemState,
} from "../src/taxonomy.js";

/**
 * The exhaustive matrix: every (from, to, cause) triple is either exactly
 * one of the design doc's edges or rejected. The design's diagrams ARE the
 * spec — if an edit to the tables adds or drops an edge, the counts here
 * fail before any capability misbehaves.
 */

const ALL_CAUSES: TransitionCause[] = [
    "intakeObserved",
    "triageCompleted",
    "contributorAssigned",
    "lastContributorUnassigned",
    "reclaimCompleted",
    "checksPassed",
    "checksFailed",
    "revisionResolved",
    "reviewPolicySatisfied",
    "newCommitsInvalidatedApproval",
    "humanClosed",
    "linkedMergeClosed",
];

describe("issue flow (taxonomy.md §4)", () => {
    const positions: (IssueMeaning | null)[] = [null, ...ISSUE_MEANINGS];

    it("allows exactly the documented edges and nothing else", () => {
        const allowed: string[] = [];
        for (const from of positions) {
            for (const to of positions) {
                for (const cause of ALL_CAUSES) {
                    if (canTransitionIssue({ from, to, cause }).allowed) {
                        allowed.push(`${String(from)}->${String(to)}:${cause}`);
                    }
                }
            }
        }
        expect(allowed.sort()).toEqual(
            [
                "null->awaitingTriage:intakeObserved",
                "awaitingTriage->ready:triageCompleted",
                "ready->inProgress:contributorAssigned",
                "inProgress->ready:lastContributorUnassigned",
                "inProgress->ready:reclaimCompleted",
                "awaitingTriage->null:humanClosed",
                "ready->null:humanClosed",
                "ready->null:linkedMergeClosed",
                "inProgress->null:humanClosed",
                "inProgress->null:linkedMergeClosed",
            ].sort(),
        );
    });

    it("rejects a PR cause on an issue edge, coded as the cause mismatch it is", () => {
        expect(
            canTransitionIssue({
                from: "awaitingTriage",
                to: "ready",
                cause: "checksPassed",
            }),
        ).toMatchObject({ allowed: false, code: "causeNotAccepted" });
    });
});

describe("pull request flow (taxonomy.md §5)", () => {
    const positions: (PrMeaning | null)[] = [null, ...PR_MEANINGS];

    it("allows exactly the documented edges and nothing else", () => {
        let count = 0;
        for (const from of positions) {
            for (const to of positions) {
                for (const cause of ALL_CAUSES) {
                    if (canTransitionPr({ from, to, cause }).allowed) count++;
                }
            }
        }
        // 2 entries + 4 internal edges + 3 positions × 2 close causes = 12
        expect(count).toBe(12);
    });

    it("readyToMerge is reachable only from needsReview", () => {
        for (const from of [null, "needsRevision", "readyToMerge"] as const) {
            for (const cause of ALL_CAUSES) {
                expect(
                    canTransitionPr({ from, to: "readyToMerge", cause }).allowed,
                ).toBe(false);
            }
        }
    });
});

describe("work-item invariants (test-architecture: invariants layer)", () => {
    const at = (meaning: IssueMeaning | null, extra?: Partial<WorkItemState<IssueMeaning>>): WorkItemState<IssueMeaning> => ({
        meaning,
        blocked: false,
        closed: false,
        ...extra,
    });

    it("an item is never in two positions — meaning is scalar by construction", () => {
        // Structural invariant: the type allows exactly one meaning. The
        // runtime counterpart: applying a legal transition replaces the
        // position, never accumulates one.
        const { state } = applyTransition(
            at("ready"),
            { from: "ready", to: "inProgress", cause: "contributorAssigned" },
            canTransitionIssue,
        );
        expect(state.meaning).toBe("inProgress");
    });

    it("a blocked item refuses every capability transition (safety.md §5)", () => {
        for (const to of [...ISSUE_MEANINGS, null]) {
            for (const cause of ALL_CAUSES) {
                const { state, verdict } = applyTransition(
                    at("ready", { blocked: true }),
                    { from: "ready", to, cause },
                    canTransitionIssue,
                );
                expect(verdict.allowed).toBe(false);
                expect(state.meaning).toBe("ready"); // position survives the pause
            }
        }
    });

    it("a stale precondition refuses instead of overwriting (human edits win)", () => {
        // The request believed the issue was `ready`; a human moved it.
        const { verdict } = applyTransition(
            at("inProgress"),
            { from: "ready", to: "inProgress", cause: "contributorAssigned" },
            canTransitionIssue,
        );
        expect(verdict).toMatchObject({ allowed: false, code: "stalePrecondition" });
    });

    it("a closed item accepts nothing", () => {
        const { verdict } = applyTransition(
            at(null, { closed: true }),
            { from: null, to: "awaitingTriage", cause: "intakeObserved" },
            canTransitionIssue,
        );
        expect(verdict).toMatchObject({ allowed: false, code: "itemClosed" });
    });

    it("the pause is reported before the edge check — a blocked item's code is itemBlocked", () => {
        const { verdict } = applyTransition(
            at("ready", { blocked: true }),
            { from: "ready", to: "inProgress", cause: "contributorAssigned" },
            canTransitionIssue,
        );
        expect(verdict).toMatchObject({ allowed: false, code: "itemBlocked" });
    });

    // Mutation-testing survivors, now pinned:
    it("a refused edge leaves the state EXACTLY unchanged — refusal must never apply", () => {
        const before = at("ready");
        const { state, verdict } = applyTransition(
            before,
            // Precondition matches, but the edge itself is illegal.
            { from: "ready", to: "awaitingTriage", cause: "triageCompleted" },
            canTransitionIssue,
        );
        expect(verdict).toMatchObject({ allowed: false, code: "noSuchEdge" });
        expect(state).toEqual(before);
    });

    it("closing transitions set closed; ordinary moves leave it unset", () => {
        const closed = applyTransition(
            at("ready"),
            { from: "ready", to: null, cause: "humanClosed" },
            canTransitionIssue,
        );
        expect(closed.state).toEqual({ meaning: null, blocked: false, closed: true });

        const moved = applyTransition(
            at("ready"),
            { from: "ready", to: "inProgress", cause: "contributorAssigned" },
            canTransitionIssue,
        );
        expect(moved.state).toEqual({ meaning: "inProgress", blocked: false, closed: false });
    });

    it("every refusal carries a non-empty human reason alongside its code", () => {
        const refusals = [
            applyTransition(at("ready", { blocked: true }), { from: "ready", to: "inProgress", cause: "contributorAssigned" }, canTransitionIssue),
            applyTransition(at(null, { closed: true }), { from: null, to: "awaitingTriage", cause: "intakeObserved" }, canTransitionIssue),
            applyTransition(at("inProgress"), { from: "ready", to: "inProgress", cause: "contributorAssigned" }, canTransitionIssue),
            applyTransition(at("ready"), { from: "ready", to: "awaitingTriage", cause: "triageCompleted" }, canTransitionIssue),
            applyTransition(at("ready"), { from: "ready", to: "inProgress", cause: "checksPassed" }, canTransitionIssue),
        ];
        for (const { verdict } of refusals) {
            expect(verdict.allowed).toBe(false);
            if (!verdict.allowed) expect(verdict.reason.length).toBeGreaterThan(0);
        }
    });
});
