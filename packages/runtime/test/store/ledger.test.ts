/**
 * The ledger's statements against a real store in a temp dir: what a fact
 * round-trips as, which sends the sweep is handed, what an item's landed
 * writes are, which warning binds, and what retention takes away. The fold
 * those reads feed is `fold.test.ts`'s; the migration that creates the tables
 * is `schema.test.ts`'s.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { useTempDir } from "@hiero-hackers/automation-testkit";
import type { ItemRef, RepositoryRef } from "@hiero-hackers/automation-core";
import type { Decision, Fact, FactKind, StoredWarning } from "../../src/store/index.js";
import { Store } from "../../src/store/store.js";

const temp = useTempDir("store-ledger-");
let path: string;

beforeEach(() => {
    path = temp.file("store.sqlite");
});

const ITEM: ItemRef = { kind: "issue", number: 40 };
const OTHER: ItemRef = { kind: "pullRequest", number: 41 };
const REPOSITORY: RepositoryRef = { owner: "o", repo: "r" };
/** The same item number in a repository this process also serves (D169). */
const ELSEWHERE: RepositoryRef = { owner: "o", repo: "other" };
const AT = "2026-09-12T09:00:00.000Z";

const fact = (over: Partial<Fact> = {}): Fact => ({
    effectId: "effect-a",
    seq: 1,
    kind: "sent",
    at: AT,
    revision: "revision-1",
    capability: "inactivity",
    repository: REPOSITORY,
    item: ITEM,
    verb: "postComment",
    login: null,
    code: null,
    detail: null,
    payload: '{"verb":"postComment"}',
    ...over,
});

const closed = (kind: FactKind, at: string, over: Partial<Fact> = {}): Fact =>
    fact({ kind, at, payload: null, ...over });

const snapshot: Omit<StoredWarning, "effectId"> = {
    warnedAt: AT,
    gracePeriodHours: 7 * 24,
    earliestActionAt: "2026-09-19T09:00:00.000Z",
    cancelledBy: "a commit or a /working comment",
    reversesWith: "re-assign / reopen",
    actionClass: "clockTriggeredDestructive",
    capability: "inactivity",
    causeObservedAt: "2026-08-01T00:00:00.000Z",
    cause: "assignmentWentStale",
    item: "o/r#40",
    change: "release alice",
};

const decision = (over: Partial<Decision> = {}): Decision => ({
    passId: "pass-1",
    source: "webhook",
    sourceId: "00000000-0000-0000-0000-000000000001",
    at: AT,
    repository: REPOSITORY,
    item: ITEM,
    capability: "inactivity",
    verdict: "apply",
    code: null,
    detail: null,
    effectId: "effect-a",
    ...over,
});

describe("the facts an effect accumulates", () => {
    it("round-trips every column, in ledger order, and folds them", () => {
        const store = new Store(path);
        const landed = closed("landed", "2026-09-12T09:00:01.000Z", { code: null });

        store.ledger.record(fact());
        store.ledger.record(landed);

        expect(store.ledger.factsOf("effect-a")).toEqual([fact(), landed]);
        expect(store.ledger.factsOf("effect-b")).toEqual([]);
        expect(store.ledger.stateOf("effect-a", 1)).toEqual({
            kind: "settled",
            how: "landed",
            seq: 1,
        });
        expect(store.ledger.stateOf("effect-b", 1)).toEqual({ kind: "neverStarted" });
        store.close();
    });

    it("refuses a fact it could not read back as an instant, or key", () => {
        const store = new Store(path);

        expect(() => store.ledger.record(fact({ at: "yesterday" }))).toThrow(/at/);
        expect(() => store.ledger.record(fact({ effectId: "  " }))).toThrow(/effectId/);
        expect(() => store.ledger.record(fact({ kind: "settled" as FactKind }))).toThrow();
        expect(store.ledger.factsOf("effect-a")).toEqual([]);
        store.close();
    });
});

describe("the sweep's worklist", () => {
    it("lists only sends nothing closed, counts their attempts less the unsent, and honours the boundary", () => {
        const store = new Store(path);

        // One effect whose call landed, one still open on its second send, and
        // one sent after the boundary the sweep asks about.
        store.ledger.record(fact({ effectId: "landed-effect" }));
        store.ledger.record(
            closed("landed", "2026-09-12T09:00:01.000Z", {
                effectId: "landed-effect",
            }),
        );
        store.ledger.record(fact({ effectId: "open-effect" }));
        store.ledger.record(
            closed("unsent", "2026-09-12T09:00:02.000Z", {
                effectId: "open-effect",
                code: "writeUnsupported",
            }),
        );
        store.ledger.record(fact({ effectId: "open-effect", at: "2026-09-12T09:00:03.000Z" }));
        store.ledger.record(fact({ effectId: "later-effect", at: "2026-09-12T10:00:00.000Z" }));

        expect(store.ledger.open("2026-09-12T09:30:00.000Z")).toEqual([
            {
                effectId: "open-effect",
                repository: REPOSITORY,
                seq: 1,
                payload: '{"verb":"postComment"}',
                attempts: 1,
                at: "2026-09-12T09:00:03.000Z",
                revision: "revision-1",
            },
        ]);
        expect(store.ledger.open("2026-09-12T11:00:00.000Z")).toHaveLength(2);
        expect(() => store.ledger.open("whenever")).toThrow(/before/);
        store.close();
    });

    /** One row per open call, however often it was sent: the sweep resolves calls, not sends. */
    it("lists a resent call once, at the instant of its newest send", () => {
        const store = new Store(path);

        store.ledger.record(fact());
        store.ledger.record(fact({ at: "2026-09-12T09:05:00.000Z" }));

        expect(store.ledger.open("2026-09-12T09:30:00.000Z")).toEqual([
            {
                effectId: "effect-a",
                repository: REPOSITORY,
                seq: 1,
                payload: '{"verb":"postComment"}',
                attempts: 2,
                at: "2026-09-12T09:05:00.000Z",
                revision: "revision-1",
            },
        ]);
        store.close();
    });
});

describe("the writes the platform made on one item", () => {
    it("returns the item's landed facts by time, and nothing else's", () => {
        const store = new Store(path);

        store.ledger.record(fact());
        store.ledger.record(
            closed("landed", "2026-09-12T09:00:01.000Z", { verb: "releaseAssignment", login: "a" }),
        );
        store.ledger.record(fact({ effectId: "effect-b", item: OTHER }));
        store.ledger.record(
            closed("landed", "2026-09-12T09:00:02.000Z", { effectId: "effect-b", item: OTHER }),
        );
        store.ledger.record(
            closed("refused", "2026-09-12T09:00:03.000Z", { effectId: "effect-c" }),
        );

        expect(store.ledger.landedOn(REPOSITORY, ITEM)).toEqual([
            { verb: "releaseAssignment", login: "a", at: "2026-09-12T09:00:01.000Z" },
        ]);
        expect(store.ledger.landedOn(REPOSITORY, OTHER)).toEqual([
            { verb: "postComment", login: null, at: "2026-09-12T09:00:02.000Z" },
        ]);
        expect(store.ledger.landedOn(REPOSITORY, { kind: "issue", number: 99 })).toEqual([]);
        store.close();
    });

    /** D169: two repositories number their items in one sequence each. */
    it("returns nothing another repository's, at the same item number", () => {
        const store = new Store(path);

        store.ledger.record(fact());
        store.ledger.record(closed("landed", "2026-09-12T09:00:01.000Z"));
        store.ledger.record(fact({ effectId: "effect-elsewhere", repository: ELSEWHERE }));
        store.ledger.record(
            closed("landed", "2026-09-12T09:00:02.000Z", {
                effectId: "effect-elsewhere",
                repository: ELSEWHERE,
                verb: "addLabel",
            }),
        );

        expect(store.ledger.landedOn(REPOSITORY, ITEM)).toEqual([
            { verb: "postComment", login: null, at: "2026-09-12T09:00:01.000Z" },
        ]);
        expect(store.ledger.landedOn(ELSEWHERE, ITEM)).toEqual([
            { verb: "addLabel", login: null, at: "2026-09-12T09:00:02.000Z" },
        ]);
        store.close();
    });
});

describe("the effects with a fact on one item", () => {
    it("names each effect once, oldest first, and nothing another item's", () => {
        const store = new Store(path);

        store.ledger.record(fact({ effectId: "effect-b" }));
        store.ledger.record(closed("landed", "2026-09-12T09:00:01.000Z", { effectId: "effect-b" }));
        store.ledger.record(fact({ effectId: "effect-a", at: "2026-09-12T09:00:02.000Z" }));
        store.ledger.record(fact({ effectId: "effect-c", item: OTHER }));

        expect(store.ledger.effectsOn(REPOSITORY, ITEM)).toEqual(["effect-b", "effect-a"]);
        expect(store.ledger.effectsOn(REPOSITORY, OTHER)).toEqual(["effect-c"]);
        expect(store.ledger.effectsOn(REPOSITORY, { kind: "issue", number: 99 })).toEqual([]);
        store.close();
    });

    /** D169: two repositories number their items in one sequence each. */
    it("names nothing another repository's, at the same item number", () => {
        const store = new Store(path);

        store.ledger.record(fact());
        store.ledger.record(fact({ effectId: "effect-elsewhere", repository: ELSEWHERE }));

        expect(store.ledger.effectsOn(REPOSITORY, ITEM)).toEqual(["effect-a"]);
        expect(store.ledger.effectsOn(ELSEWHERE, ITEM)).toEqual(["effect-elsewhere"]);
        store.close();
    });
});

describe("the warning that binds", () => {
    it("keeps the first, ignores a second, and answers null for an unwarned effect", () => {
        const store = new Store(path);
        const warned = (at: string, payload: Omit<StoredWarning, "effectId">): Fact =>
            closed("warned", at, { seq: 0, verb: null, payload: JSON.stringify(payload) });

        expect(store.ledger.warningFor("effect-a")).toBeNull();
        store.ledger.record(warned(AT, snapshot));
        store.ledger.record(
            warned("2026-09-13T09:00:00.000Z", {
                ...snapshot,
                warnedAt: "2026-09-13T09:00:00.000Z",
            }),
        );

        expect(store.ledger.warningFor("effect-a")).toEqual({ ...snapshot, effectId: "effect-a" });
        expect(store.ledger.factsOf("effect-a")).toHaveLength(1);
        expect(store.ledger.warningFor("effect-b")).toBeNull();
        store.close();
    });

    it.each([
        ["a number", "42"],
        ["null", "null"],
        ["an array", "[]"],
        ["not JSON", "{oops"],
    ])("answers null for a warned payload that is %s", (_what, payload) => {
        const store = new Store(path);
        store.ledger.record(closed("warned", AT, { seq: 0, verb: null, payload }));
        expect(store.ledger.warningFor("effect-a")).toBeNull();
        store.close();
    });

    it("names the argument an instant guard refused", () => {
        const store = new Store(path);
        expect(() => store.ledger.record(fact({ at: "yesterday" }))).toThrow(/\bat\b/);
        expect(() => store.ledger.claim("e", "w", "yesterday", AT)).toThrow(/\bnow\b/);
        expect(() => store.ledger.verdictsSince("yesterday")).toThrow(/\bsince\b/);
        expect(() =>
            store.ledger.decide({
                passId: "p",
                source: "webhook",
                sourceId: "p",
                at: "yesterday",
                repository: REPOSITORY,
                item: ITEM,
                capability: "inactivity",
                verdict: "info",
                code: null,
                detail: null,
                effectId: null,
            }),
        ).toThrow(/\bat\b/);
        store.close();
    });

    it("answers null for a warned fact that carries no payload", () => {
        const store = new Store(path);
        store.ledger.record(closed("warned", AT, { seq: 0, verb: null, payload: null }));
        expect(store.ledger.warningFor("effect-a")).toBeNull();
        store.close();
    });
});

describe("the decisions a pass records", () => {
    it("lists one item's decisions by time and validates the row", () => {
        const store = new Store(path);

        store.ledger.decide(decision());
        store.ledger.decide(
            decision({
                at: "2026-09-12T09:00:01.000Z",
                source: "sweep",
                verdict: "refused",
                code: "closedByHuman",
                detail: "the item is closed",
                effectId: null,
            }),
        );
        store.ledger.decide(decision({ item: OTHER }));

        expect(store.ledger.decisionsOn(REPOSITORY, ITEM).map((row) => row.verdict)).toEqual([
            "apply",
            "refused",
        ]);
        expect(store.ledger.decisionsOn(REPOSITORY, OTHER)).toEqual([decision({ item: OTHER })]);
        expect(() => store.ledger.decide(decision({ at: "soon" }))).toThrow(/at/);
        expect(() => store.ledger.decide(decision({ passId: " " }))).toThrow(/passId/);
        store.close();
    });

    /** D169: two repositories number their items in one sequence each. */
    it("lists nothing another repository's, at the same item number", () => {
        const store = new Store(path);

        store.ledger.decide(decision());
        store.ledger.decide(decision({ passId: "pass-elsewhere", repository: ELSEWHERE }));

        expect(store.ledger.decisionsOn(REPOSITORY, ITEM)).toEqual([decision()]);
        expect(store.ledger.decisionsOn(ELSEWHERE, ITEM)).toEqual([
            decision({ passId: "pass-elsewhere", repository: ELSEWHERE }),
        ]);
        store.close();
    });
});

describe("retention", () => {
    it("removes a settled effect whole and keeps one with an open send", () => {
        const store = new Store(path);

        store.ledger.record(fact({ effectId: "settled-effect" }));
        store.ledger.record(closed("landed", AT, { effectId: "settled-effect" }));
        store.ledger.record(fact({ effectId: "open-effect" }));
        store.ledger.record(fact({ effectId: "recent-effect", at: "2026-09-20T09:00:00.000Z" }));
        store.ledger.record(
            closed("landed", "2026-09-20T09:00:01.000Z", { effectId: "recent-effect" }),
        );

        expect(store.ledger.prune("2026-09-12T08:00:00.000Z")).toBe(0);
        expect(store.ledger.prune(AT)).toBe(2);
        expect(store.ledger.factsOf("settled-effect")).toEqual([]);
        expect(store.ledger.factsOf("open-effect")).toHaveLength(1);
        expect(store.ledger.factsOf("recent-effect")).toHaveLength(2);
        expect(() => store.ledger.prune("whenever")).toThrow(/before/);
        store.close();
    });

    /** D166: the promise made to a person outlives the window, so the effect holding it stays. */
    it("keeps a settled effect whose warning promises an action still ahead", () => {
        const store = new Store(path);
        const promise = (effectId: string, earliestActionAt: string): Fact =>
            closed("warned", AT, {
                effectId,
                seq: 0,
                verb: null,
                payload: JSON.stringify({ ...snapshot, earliestActionAt }),
            });

        store.ledger.record(promise("ahead", "2026-09-19T09:00:00.000Z"));
        store.ledger.record(promise("elapsed", AT));
        // Bytes nobody can read are no promise, and `json_extract` raises on them.
        store.ledger.record(
            closed("warned", AT, { effectId: "unreadable", seq: 0, verb: null, payload: "{" }),
        );

        expect(store.ledger.prune(AT)).toBe(2);
        expect(store.ledger.factsOf("ahead")).toHaveLength(1);
        expect(store.ledger.factsOf("elapsed")).toEqual([]);
        expect(store.ledger.factsOf("unreadable")).toEqual([]);
        expect(store.ledger.prune("2026-09-19T09:00:00.000Z")).toBe(1);
        expect(store.ledger.factsOf("ahead")).toEqual([]);
        store.close();
    });

    it("prunes decision rows on their own boundary", () => {
        const store = new Store(path);

        store.ledger.decide(decision());
        store.ledger.decide(decision({ at: "2026-09-20T09:00:00.000Z", passId: "pass-2" }));

        expect(store.ledger.pruneDecisions("2026-09-12T08:00:00.000Z")).toBe(0);
        expect(store.ledger.pruneDecisions(AT)).toBe(1);
        expect(store.ledger.decisionsOn(REPOSITORY, ITEM)).toHaveLength(1);
        expect(() => store.ledger.pruneDecisions("whenever")).toThrow(/before/);
        store.close();
    });
});
