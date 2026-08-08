/**
 * The factory's contracts (D92 3d): what it stamps, what it defaults, and
 * that its output is indistinguishable from a hand-built intent everywhere
 * it matters — the screens and the idempotency key.
 */

import { describe, expect, it } from "vitest";
import {
    declareCapability,
    deriveIdempotencyKey,
    intentFactory,
    screenIntent,
} from "../../src/index.js";

const occasion = {
    repository: { owner: "o", repo: "r" },
    item: { kind: "issue", number: 7 },
    observedAt: new Date("2026-08-07T01:00:00Z"),
} as const;

const make = intentFactory("triage", occasion);

const label = () =>
    make({
        operation: "applyMappedLabel",
        actionClass: "reversibleStateChange",
        desired: { meaning: "awaitingTriage", cause: "intakeObserved" },
        cause: "issueWithoutPosition",
        explain: { summary: "New issue placed in triage." },
    });

describe("what the factory stamps", () => {
    it("binds the occasion and attributes the explanation", () => {
        const intent = label();
        expect(intent.capability).toBe("triage");
        expect(intent.repository).toEqual(occasion.repository);
        expect(intent.item).toEqual(occasion.item);
        expect(intent.cause).toEqual({
            cause: "issueWithoutPosition",
            observedAt: occasion.observedAt,
        });
        expect(intent.explanation).toEqual({
            capability: "triage",
            summary: "New issue placed in triage.",
            detail: [],
        });
    });

    it("derives the same key the hand path derives", () => {
        const intent = label();
        expect(intent.idempotencyKey).toBe(deriveIdempotencyKey(intent));
    });

    it("the key identifies the occasion, not the payload — a reworded comment is one effect", () => {
        const a = make({
            operation: "postManagedComment",
            actionClass: "humanFacingOutput",
            desired: { marker: "<!-- m -->", body: "first wording" },
            cause: "prWithoutLinkedIssue",
            explain: { summary: "s" },
        });
        const b = make({
            operation: "postManagedComment",
            actionClass: "humanFacingOutput",
            desired: { marker: "<!-- m -->", body: "second wording" },
            cause: "prWithoutLinkedIssue",
            explain: { summary: "s" },
        });
        expect(a.idempotencyKey).toBe(b.idempotencyKey);
    });
});

describe("what the factory defaults", () => {
    it("an omitted expected claims NOTHING — closed is no-claim, not open", () => {
        expect(label().expected).toEqual({
            meaningsPresent: [],
            meaningsAbsent: [],
            closed: null,
        });
    });

    it("a partial expected fills only the stated clause", () => {
        const intent = make({
            operation: "applyMappedLabel",
            actionClass: "reversibleStateChange",
            desired: { meaning: "awaitingTriage", cause: "intakeObserved" },
            cause: "c",
            expected: { meaningsAbsent: ["awaitingTriage"], closed: false },
            explain: { summary: "s" },
        });
        expect(intent.expected).toEqual({
            meaningsPresent: [],
            meaningsAbsent: ["awaitingTriage"],
            closed: false,
        });
    });

    it("no destructive field means no destructive KEY — absent, not undefined", () => {
        expect("destructive" in label()).toBe(false);
    });

    it("a destructive record passes through intact", () => {
        const destructive = {
            warnedAt: new Date("2026-07-30T00:00:00Z"),
            gracePeriodDays: 7,
            earliestActionAt: new Date("2026-08-06T00:00:00Z"),
            cancelledBy: "activity",
            reversesWith: "reassigning",
            qualifyingActivitySinceWarning: false,
            warnedCause: "inactivity",
            warnedCauseObservedAt: new Date("2026-07-30T00:00:00Z"),
        };
        const intent = make({
            operation: "unassign",
            actionClass: "clockTriggeredDestructive",
            desired: { login: "someone" },
            cause: "graceElapsed",
            destructive,
            explain: { summary: "s" },
        });
        expect(intent.destructive).toEqual(destructive);
    });
});

describe("factory output is screen-clean", () => {
    it("a factory-made intent passes the screens a hand-built one passes", () => {
        const declaration = declareCapability({
            name: "triage",
            triggers: [{ kind: "event", event: "issues" }],
            configKeys: [],
            observations: ["issueUpdated"],
            resolvers: [],
            intents: [
                {
                    name: "applyMappedLabel",
                    idempotencyClass: "idempotent",
                    requiredPermissions: ["issues:write"],
                },
            ],
            permissions: { repository: ["issues:write"], organization: [] },
            operationalNeeds: {
                schedule: false,
                durableState: "none",
                crossItemCoordination: false,
                externalDelivery: false,
            },
        });
        expect(screenIntent(label(), declaration)).toEqual({ ok: true });
    });
});
