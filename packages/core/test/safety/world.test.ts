/**
 * `world.ts`'s derivation, tested before anything composes it (D92 phase 1):
 * if these two functions are wrong, the engine inherits a lie — the same lie
 * the old API let shells assert, now with one owner to fix.
 */

import { describe, expect, it } from "vitest";
import {
    deriveWorld,
    expectedHolds,
    observedMeaningsOf,
    projectIssue,
    projectPullRequest,
} from "../../src/index.js";

const project = projectIssue;

describe("observedMeaningsOf reassembles what projection split", () => {
    it("a bare item observes nothing", () => {
        expect(observedMeaningsOf(project({ closedBy: null, meanings: [] }))).toEqual([]);
    });

    it("position + blocked + cross-flow reassemble, in vocabulary order", () => {
        const projection = project({
            closedBy: null,
            meanings: ["needsReview", "blocked", "ready"],
        });
        expect(observedMeaningsOf(projection)).toEqual(["ready", "needsReview", "blocked"]);
    });

    it("a conflict's positions all survive the reassembly", () => {
        const projection = project({
            closedBy: null,
            meanings: ["awaitingTriage", "inProgress", "blocked"],
        });
        expect(projection.kind).toBe("conflict");
        expect(observedMeaningsOf(projection)).toEqual(["awaitingTriage", "inProgress", "blocked"]);
    });

    /**
     * A conflict that is NOT paused. Every conflict above carried `blocked`,
     * so a reassembly that simply asserted the pause on the conflict branch
     * looked identical — and it is not: `blocked` is what the safety
     * engine's `itemBlocked` rule reads, so an invented pause silences every
     * capability on an item nobody paused.
     */
    it("a conflicted item that nobody paused does not read as paused", () => {
        const projection = project({
            closedBy: null,
            meanings: ["awaitingTriage", "inProgress"],
        });
        expect(projection.kind).toBe("conflict");
        expect(observedMeaningsOf(projection)).toEqual(["awaitingTriage", "inProgress"]);
    });

    it("round-trips: any observed meaning set survives project → reassemble", () => {
        for (const meanings of [
            ["ready"],
            ["blocked"],
            ["ready", "needsRevision"],
            ["awaitingTriage", "ready", "readyToMerge", "blocked"],
        ] as const) {
            const projection = project({ closedBy: null, meanings: [...meanings] });
            expect(new Set(observedMeaningsOf(projection))).toEqual(new Set(meanings));
        }
    });
});

describe("expectedHolds — the claim against the world", () => {
    const at = (meanings: readonly ("ready" | "blocked" | "needsReview")[]) =>
        project({ closedBy: null, meanings: [...meanings] });

    it("a vacuous claim always holds", () => {
        expect(
            expectedHolds({ meaningsPresent: [], meaningsAbsent: [], closed: null }, at(["ready"])),
        ).toBe(true);
    });

    it("present must be present", () => {
        const claims = { meaningsPresent: ["ready"], meaningsAbsent: [], closed: null } as const;
        expect(expectedHolds(claims, at(["ready"]))).toBe(true);
        expect(expectedHolds(claims, at([]))).toBe(false);
    });

    it("absent must be absent — the intake case", () => {
        const claims = {
            meaningsPresent: [],
            meaningsAbsent: ["awaitingTriage"],
            closed: false,
        } as const;
        expect(expectedHolds(claims, project({ closedBy: null, meanings: [] }))).toBe(true);
        expect(
            expectedHolds(claims, project({ closedBy: null, meanings: ["awaitingTriage"] })),
        ).toBe(false);
    });

    it("the closed claim reads both projection branches (the closureOf trap)", () => {
        const wantsOpen = { meaningsPresent: [], meaningsAbsent: [], closed: false } as const;
        expect(expectedHolds(wantsOpen, project({ closedBy: "closedByHuman", meanings: [] }))).toBe(
            false,
        );
        // The conflict branch carries closure at the top level — a
        // position-only reading would call this open.
        const conflicted = project({
            closedBy: "closedByHuman",
            meanings: ["awaitingTriage", "ready"],
        });
        expect(conflicted.kind).toBe("conflict");
        expect(expectedHolds(wantsOpen, conflicted)).toBe(false);
        expect(
            expectedHolds({ meaningsPresent: [], meaningsAbsent: [], closed: true }, conflicted),
        ).toBe(true);
    });

    it("cross-flow noise neither satisfies nor violates an own-flow claim wrongly", () => {
        const projection = projectPullRequest({
            closedBy: null,
            meanings: ["needsReview", "awaitingTriage"],
        });
        expect(
            expectedHolds(
                { meaningsPresent: ["needsReview"], meaningsAbsent: [], closed: false },
                projection,
            ),
        ).toBe(true);
        // A claim about the OTHER flow's meaning still reads the truth:
        // awaitingTriage is observably there (in `ignored`), so claiming
        // its absence fails — the engine does not pretend noise away.
        expect(
            expectedHolds(
                { meaningsPresent: [], meaningsAbsent: ["awaitingTriage"], closed: false },
                projection,
            ),
        ).toBe(false);
    });
});

/**
 * The mode arm. A native mode is not a label and not a meaning, so it is
 * claimed on its own and judged against what an observation READ — which is
 * the whole reason `ObservedModes` leaves an unread mode out rather than
 * calling it `false`.
 */
describe("expectedHolds — the claim against a native mode", () => {
    const open = projectPullRequest({ closedBy: null, meanings: [] });
    const claiming = (mode: "draft" | "changesRequested") =>
        ({ meaningsPresent: [], meaningsAbsent: [], closed: null, pullRequestMode: mode }) as const;

    it("holds when the mode the decision saw is still the mode", () => {
        expect(expectedHolds(claiming("draft"), open, { draft: true })).toBe(true);
        expect(expectedHolds(claiming("changesRequested"), open, { changesRequested: true })).toBe(
            true,
        );
    });

    it("fails when the mode moved — marked ready, or the request lifted", () => {
        expect(expectedHolds(claiming("draft"), open, { draft: false })).toBe(false);
        expect(expectedHolds(claiming("changesRequested"), open, { changesRequested: false })).toBe(
            false,
        );
    });

    it("fails when nobody read the mode, and when somebody read the other one", () => {
        expect(expectedHolds(claiming("draft"), open, {})).toBe(false);
        expect(expectedHolds(claiming("draft"), open, { changesRequested: true })).toBe(false);
        // The default is the same answer: a caller that read no mode at all.
        expect(expectedHolds(claiming("draft"), open)).toBe(false);
    });

    it("leaves an unclaimed mode alone, whatever was read", () => {
        const vacuous = { meaningsPresent: [], meaningsAbsent: [], closed: null } as const;
        expect(expectedHolds(vacuous, open, { draft: false })).toBe(true);
        expect(expectedHolds(vacuous, open, {})).toBe(true);
    });
});

describe("deriveWorld authoritative preconditions", () => {
    const emptyClaims = { meaningsPresent: [], meaningsAbsent: [], closed: null } as const;

    it("refuses to establish or invent facts without a projection", () => {
        expect(deriveWorld(null, emptyClaims)).toMatchObject({
            observedMeanings: [],
            preconditionHolds: false,
        });
    });

    it("refuses to establish a precondition from a conflicted projection", () => {
        const conflicted = project({
            closedBy: null,
            meanings: ["awaitingTriage", "inProgress"],
        });
        expect(conflicted.kind).toBe("conflict");
        expect(deriveWorld(conflicted, emptyClaims).preconditionHolds).toBe(false);
    });

    it("carries the observation's own meanings, not an empty world", () => {
        // The other half of the derived world, and the half the rules
        // actually read: `itemBlocked` refuses on `observedMeanings`, so a
        // world that answered `[]` for every projection would quietly unpause
        // every paused item.
        const paused = project({ closedBy: null, meanings: ["ready", "blocked"] });
        expect(deriveWorld(paused, emptyClaims).observedMeanings).toEqual(["ready", "blocked"]);
    });

    /**
     * The fact the `itemClosed` rule reads. It is derived from the
     * observation, never from `claims.closed` — the claim defaults to `null`,
     * so a world that took closure from the capability would report every
     * silent capability's target as open.
     */
    it("carries the observed closure, from either projection branch", () => {
        expect(
            deriveWorld(project({ closedBy: "merged", meanings: [] }), emptyClaims).closure,
        ).toBe("merged");
        const conflicted = project({
            closedBy: "closedByHuman",
            meanings: ["awaitingTriage", "inProgress"],
        });
        expect(conflicted.kind).toBe("conflict");
        expect(deriveWorld(conflicted, emptyClaims).closure).toBe("closedByHuman");
        expect(
            deriveWorld(project({ closedBy: null, meanings: [] }), emptyClaims).closure,
        ).toBeNull();
    });

    it("invents no closure without a projection, and cannot be reached with one", () => {
        const world = deriveWorld(null, emptyClaims);
        expect(world.closure).toBeNull();
        // The pair is what makes `null` honest rather than a claim of
        // openness: no projection means the preflight refuses
        // `preconditionStale` before any rule reads `closure`.
        expect(world.preconditionHolds).toBe(false);
    });

    it("checks requested facts against a clean authoritative projection", () => {
        const clean = project({ closedBy: null, meanings: ["ready"] });
        expect(deriveWorld(clean, emptyClaims).preconditionHolds).toBe(true);
        expect(
            deriveWorld(clean, { meaningsPresent: [], meaningsAbsent: ["ready"], closed: null })
                .preconditionHolds,
        ).toBe(false);
    });

    it("carries what was read of the native modes, and judges a mode claim by it", () => {
        const open = projectPullRequest({ closedBy: null, meanings: [] });
        const claim = {
            meaningsPresent: [],
            meaningsAbsent: [],
            closed: null,
            pullRequestMode: "draft",
        } as const;

        expect(deriveWorld(open, claim, { draft: true })).toMatchObject({
            modes: { draft: true },
            preconditionHolds: true,
        });
        expect(deriveWorld(open, claim, { draft: false }).preconditionHolds).toBe(false);
        // Nothing read is the default, and it is not a pass.
        expect(deriveWorld(open, claim)).toMatchObject({ modes: {}, preconditionHolds: false });
    });
});
