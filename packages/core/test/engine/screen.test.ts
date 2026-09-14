/**
 * The screens the engine runs on everything `evaluate` returns: attribution,
 * the derived key, the grace terms, and the workflow map (D175).
 */

import { describe, expect, it } from "vitest";
import {
    declareCapability,
    deriveIdempotencyKey,
    flag,
    intentFactoryFor,
    spec,
    type AnyIntent,
} from "../../src/index.js";
import { readIntent, screenIntent } from "../../src/engine/invoke.js";

const declaration = declareCapability({
    name: "fixture",
    triggers: [{ kind: "event", event: "issues" }],
    settings: spec({ announce: flag({ default: false }) }),
    requiredMappings: {},
    facts: ["issue"],
    needs: [],
    resolvers: ["linkedIssues"],
    intents: ["applyMappedLabel", "unassign"],
});

const AT = new Date("2026-08-05T09:00:00.000Z");

/**
 * A well-formed intent, overridable field by field. The key is DERIVED from
 * whatever the overrides produced, so every screen below is exercised against
 * an intent the platform would accept — a literal key would refuse them all
 * at `idempotencyKeyMismatch` instead. Pass `idempotencyKey` to test that
 * screen itself.
 */
const intent = (over: Record<string, unknown> = {}): AnyIntent => {
    const base = {
        capability: "fixture",
        repository: { owner: "o", repo: "r" },
        item: { kind: "issue", number: 1 },
        operation: "applyMappedLabel",
        claims: { meaningsPresent: [], meaningsAbsent: [], closed: false },
        desired: { meaning: "awaitingTriage", cause: "intakeObserved" },
        cause: { cause: "someCause", observedAt: AT },
        explanation: { capability: "fixture", summary: "s", detail: [] },
        grace: null,
        ...over,
    } as unknown as Omit<AnyIntent, "idempotencyKey"> & { readonly idempotencyKey?: string };
    return {
        ...base,
        idempotencyKey: base.idempotencyKey ?? deriveIdempotencyKey(base),
    } as AnyIntent;
};

describe("screenIntent", () => {
    const position = (meaning: "ready" | "needsReview" | null = null) => ({
        kind: "position" as const,
        state: { meaning, blocked: false, closedBy: null },
        ignored: [],
    });
    const conflict = {
        kind: "conflict" as const,
        positions: ["ready", "inProgress"] as const,
        blocked: false,
        closedBy: null,
        ignored: [],
    };

    it("accepts a well-formed intent against an authoritative position", () => {
        expect(screenIntent(intent(), declaration, position())).toEqual({ ok: true });
    });

    it.each([null, {}, { operation: "applyMappedLabel" }])(
        "refuses malformed runtime value %#",
        (value) => {
            expect(screenIntent(value, declaration, position())).toMatchObject({
                ok: false,
                code: "malformedIntent",
            });
        },
    );

    it.each([
        { ...intent(), operation: "unknown" },
        { ...intent(), desired: { meaning: "ready" } },
        {
            ...intent(),
            claims: { meaningsPresent: new Array(1), meaningsAbsent: [], closed: false },
        },
        {
            ...intent(),
            grace: {
                days: Number.POSITIVE_INFINITY,
                warning: { body: "warn" },
                notice: { body: "done" },
                cancelledBy: "activity",
                reversesWith: "retry",
                activityAt: null,
            },
        },
        {
            ...intent(),
            grace: {
                days: 7,
                warning: { body: "warn" },
                notice: { body: "done" },
                cancelledBy: "activity",
                reversesWith: "retry",
                activityAt: new Date("invalid"),
            },
        },
    ])("refuses malformed nested value %#", (value) => {
        expect(screenIntent(value, declaration, position())).toMatchObject({
            ok: false,
            code: "malformedIntent",
        });
    });

    it("contains hostile property access", () => {
        const value = new Proxy(
            {},
            {
                getOwnPropertyDescriptor: () => {
                    throw new Error("no");
                },
            },
        );
        expect(screenIntent(value, declaration, position())).toMatchObject({
            ok: false,
            code: "malformedIntent",
        });
    });

    it("refuses foreign, undeclared, and malformed intents with distinct reasons", () => {
        const candidates = [
            screenIntent(intent({ capability: "other" }), declaration, position()),
            screenIntent(
                intent({
                    operation: "postManagedComment",
                    desired: { kind: "summary", body: "b" },
                }),
                declaration,
                position(),
            ),
            // An explicit key, because deriving one from this cause is what
            // the screen order exists to avoid: `toISOString()` throws on an
            // invalid date, so `invalidCause` must answer first.
            screenIntent(
                intent({
                    cause: { cause: "c", observedAt: new Date(Number.NaN) },
                    idempotencyKey: "k",
                }),
                declaration,
                position(),
            ),
        ];
        expect(candidates.map((candidate) => (candidate.ok ? null : candidate.code))).toEqual([
            "foreignCapability",
            "undeclaredIntent",
            "invalidCause",
        ]);
        for (const candidate of candidates) {
            expect(candidate.ok).toBe(false);
            if (!candidate.ok) expect(candidate.reason.length).toBeGreaterThan(0);
        }
    });

    /**
     * The key is the store's `effect_id` (D65), and the screen exists for the
     * same reason the others do: a capability is ordinary code that can be
     * built from `unknown`, so the boundary re-derives rather than trusting
     * what came back. A capability free to name its own key could merge two
     * effects into one, or split a redelivery into two comments.
     */
    it("refuses an intent whose idempotency key is not the derived one", () => {
        const screen = screenIntent(intent({ idempotencyKey: "k" }), declaration, position());
        expect(screen).toMatchObject({ ok: false, code: "idempotencyKeyMismatch" });
        if (!screen.ok) expect(screen.reason.length).toBeGreaterThan(0);
    });

    /** A key derived from a DIFFERENT occasion is as wrong as an invented one. */
    it("refuses a key derived from another occasion", () => {
        const elsewhere = deriveIdempotencyKey({
            capability: "fixture",
            repository: { owner: "o", repo: "r" },
            item: { kind: "issue", number: 2 },
            operation: "applyMappedLabel",
            cause: { cause: "someCause", observedAt: AT },
        });
        expect(
            screenIntent(intent({ idempotencyKey: elsewhere }), declaration, position()),
        ).toMatchObject({ ok: false, code: "idempotencyKeyMismatch" });
    });

    it("passes an intent the factory built, key and all", () => {
        const built = intentFactoryFor(declaration, {
            repository: { owner: "o", repo: "r" },
            item: { kind: "issue", number: 1 },
            observedAt: AT,
        })({
            operation: "applyMappedLabel",
            desired: { meaning: "awaitingTriage", cause: "intakeObserved" },
            cause: "someCause",
            claims: { closed: false },
            explain: { summary: "s" },
        });
        expect(screenIntent(built, declaration, position())).toEqual({ ok: true });
    });

    it("refuses a mapped-label intent when authoritative position is unavailable", () => {
        expect(screenIntent(intent(), declaration, null)).toEqual({
            ok: false,
            code: "authoritativePositionUnavailable",
            reason: "the authoritative current position is unavailable",
        });
    });

    it("uses an observed conflict even when the capability claims a clean state", () => {
        const screen = screenIntent(
            intent({
                claims: {
                    meaningsPresent: [],
                    meaningsAbsent: ["ready", "inProgress"],
                    closed: false,
                },
            }),
            declaration,
            conflict,
        );
        expect(screen).toMatchObject({ ok: false, code: "positionConflict" });
        // The refusal names WHICH positions collided: "the item is
        // confused" is not something a maintainer can act on, and the
        // conjunction is what makes two of them read as two.
        if (!screen.ok) expect(screen.reason).toContain("ready and inProgress");
    });

    it("does not let a claimed current position replace the observed position", () => {
        expect(
            screenIntent(
                intent({
                    claims: { meaningsPresent: ["ready"], meaningsAbsent: [], closed: false },
                }),
                declaration,
                position(),
            ),
        ).toEqual({ ok: true });
        expect(
            screenIntent(
                intent({
                    claims: { meaningsPresent: [], meaningsAbsent: ["ready"], closed: false },
                    desired: { meaning: "inProgress", cause: "contributorAssigned" },
                }),
                declaration,
                position("ready"),
            ),
        ).toEqual({ ok: true });
    });

    it("leaves non-transition operations to the safety gate", () => {
        expect(
            screenIntent(
                intent({ operation: "unassign", desired: { login: "someone" } }),
                declaration,
                null,
            ),
        ).toEqual({ ok: true });
    });
});

/**
 * The claim vocabulary as the boundary reads it. A capability is ordinary code
 * that can be built from `unknown`, so the mode claim is checked against the
 * closed list here rather than trusted from the compiler.
 */
describe("the pull-request mode claim", () => {
    const position = {
        kind: "position" as const,
        state: { meaning: null, blocked: false, closedBy: null },
        ignored: [],
    };
    const claiming = (mode: unknown) =>
        intent({
            claims: {
                meaningsPresent: [],
                meaningsAbsent: [],
                closed: false,
                pullRequestMode: mode,
            },
        });

    it("accepts either native mode", () => {
        expect(screenIntent(claiming("draft"), declaration, position)).toEqual({ ok: true });
        expect(screenIntent(claiming("changesRequested"), declaration, position)).toEqual({
            ok: true,
        });
    });

    it.each([
        ["a mode nobody has", "readyToMerge"],
        ["a meaning", "needsRevision"],
        ["a number", 1],
    ])("refuses %s as a mode", (_label, mode) => {
        expect(screenIntent(claiming(mode), declaration, position)).toMatchObject({
            ok: false,
            code: "malformedIntent",
        });
    });

    /**
     * The compatibility claim: a value written before the mode was claimable
     * carries no such key, and must read back as CLAIMING NOTHING rather than
     * as malformed or as a claim of `undefined`.
     */
    it("reads a claim with no mode as one that makes none", () => {
        const parsed = readIntent(intent());
        expect(parsed?.claims).toEqual({
            meaningsPresent: [],
            meaningsAbsent: [],
            closed: false,
        });
        expect(parsed !== null && "pullRequestMode" in parsed.claims).toBe(false);
    });
});

describe("authoritative transition-map screening", () => {
    const issuePosition = (meaning: "ready" | null = null) => ({
        kind: "position" as const,
        state: { meaning, blocked: false, closedBy: null },
        ignored: [],
    });
    const pullRequestPosition = (meaning: "needsReview" | null = null) => ({
        kind: "position" as const,
        state: { meaning, blocked: false, closedBy: null },
        ignored: [],
    });

    it("refuses wrong-flow desired and observed positions", () => {
        const wrongDesired = screenIntent(
            intent({ desired: { meaning: "readyToMerge", cause: "intakeObserved" } }),
            declaration,
            issuePosition(),
        );
        expect(wrongDesired).toMatchObject({ ok: false, code: "meaningWrongEntity" });
        if (!wrongDesired.ok) expect(wrongDesired.reason).toContain("issue position");

        const wrongObserved = screenIntent(
            intent({ desired: { meaning: "awaitingTriage", cause: "intakeObserved" } }),
            declaration,
            pullRequestPosition("needsReview"),
        );
        expect(wrongObserved).toMatchObject({ ok: false, code: "meaningWrongEntity" });
        if (!wrongObserved.ok) expect(wrongObserved.reason).toContain("issue position");
    });

    /**
     * The same two refusals from the pull-request side. The screen has two
     * entity branches and every wrong-flow test above entered the issue one,
     * so the pull-request guards — and the half of the sentence that says
     * "a pull request" — had never run at all.
     */
    it("refuses wrong-flow desired and observed positions on a pull request too", () => {
        const wrongDesired = screenIntent(
            intent({
                item: { kind: "pullRequest", number: 9 },
                desired: { meaning: "ready", cause: "checksPassed" },
            }),
            declaration,
            pullRequestPosition(),
        );
        expect(wrongDesired).toMatchObject({ ok: false, code: "meaningWrongEntity" });
        if (!wrongDesired.ok) {
            expect(wrongDesired.reason).toContain("not a pull request position");
            expect(wrongDesired.reason).toContain("ready");
        }

        const wrongObserved = screenIntent(
            intent({
                item: { kind: "pullRequest", number: 9 },
                desired: { meaning: "needsReview", cause: "checksPassed" },
            }),
            declaration,
            {
                kind: "position" as const,
                // A human's issue label on a pull request: observable, and
                // not a position this flow can move from.
                state: { meaning: "awaitingTriage" as const, blocked: false, closedBy: null },
                ignored: [],
            },
        );
        expect(wrongObserved).toMatchObject({ ok: false, code: "meaningWrongEntity" });
        if (!wrongObserved.ok) {
            expect(wrongObserved.reason).toContain("awaitingTriage");
            expect(wrongObserved.reason).toContain("not a pull request position");
        }
    });

    it("refuses an undocumented issue edge from the observed position", () => {
        const screen = screenIntent(
            intent({ desired: { meaning: "inProgress", cause: "intakeObserved" } }),
            declaration,
            issuePosition("ready"),
        );
        expect(screen).toMatchObject({ ok: false, code: "transitionNotOnMap" });
        if (!screen.ok) expect(screen.reason).toContain("ready");
    });

    it("refuses a pull-request cause on an issue", () => {
        const wrongCause = screenIntent(
            intent({ desired: { meaning: "awaitingTriage", cause: "reviewPolicySatisfied" } }),
            declaration,
            issuePosition(),
        );
        expect(wrongCause).toMatchObject({ ok: false, code: "transitionNotOnMap" });
        if (!wrongCause.ok) {
            expect(wrongCause.reason).toContain("issue-flow cause");
            // An item at no position says so. The alternative renders as a
            // move that starts nowhere, which reads as a missing word.
            expect(wrongCause.reason).toContain("no position → awaitingTriage");
        }
    });

    it("refuses a capability-written pause", () => {
        const screen = screenIntent(
            intent({ desired: { meaning: "blocked", cause: "intakeObserved" } }),
            declaration,
            issuePosition(),
        );
        expect(screen).toMatchObject({ ok: false, code: "pauseNotCapabilityWritable" });
        // D79 is the whole content of this refusal: a capability that reads
        // only the code learns nothing about who may pause an item.
        if (!screen.ok) expect(screen.reason).toContain("only a human may set");
    });

    it("enforces pull-request causes and edges", () => {
        const pullRequestIntent = intent({
            item: { kind: "pullRequest", number: 9 },
            desired: { meaning: "readyToMerge", cause: "reviewPolicySatisfied" },
        });
        expect(
            screenIntent(pullRequestIntent, declaration, pullRequestPosition("needsReview")),
        ).toEqual({ ok: true });

        const wrongCause = screenIntent(
            intent({
                item: { kind: "pullRequest", number: 9 },
                desired: { meaning: "needsReview", cause: "triageCompleted" },
            }),
            declaration,
            pullRequestPosition(),
        );
        expect(wrongCause).toMatchObject({ ok: false, code: "transitionNotOnMap" });
        if (!wrongCause.ok) expect(wrongCause.reason).toContain("pull-request-flow cause");
    });
});
