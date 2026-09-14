/**
 * The warning an act carries in the ledger: one `warned` fact per act, appended
 * when that act's warning comment lands and read back when the act next asks
 * (grace.md §4).
 *
 * The fact is written here by hand rather than through the applier, because what
 * these rows depend on is the PAYLOAD — the snapshot the destructive gate matches
 * against the request it is asked about, and which binds from the first write
 * (D162). The fold over an effect's facts is `fold.test.ts`'s; the migration that
 * creates the table is `schema.test.ts`'s.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { useTempDir } from "@hiero-hackers/automation-testkit";
import { Store } from "../../src/store/store.js";
import type { Fact, StoredWarning } from "../../src/store/index.js";

const temp = useTempDir("store-warnings-");
let path: string;

beforeEach(() => {
    path = temp.file("store.sqlite");
});

const ACT =
    '["inactivity","o","r","issue","40","releaseAssignment","assignmentWentStale","2026-08-01T00:00:00.000Z"]';

const snapshot = (over: Partial<StoredWarning> = {}): Omit<StoredWarning, "effectId"> => ({
    warnedAt: "2026-09-01T00:00:00.000Z",
    gracePeriodHours: 7 * 24,
    earliestActionAt: "2026-09-08T00:00:00.000Z",
    cancelledBy: "a commit or a /working comment",
    reversesWith: "re-assign / reopen",
    actionClass: "clockTriggeredDestructive",
    capability: "inactivity",
    causeObservedAt: "2026-08-01T00:00:00.000Z",
    cause: "assignmentWentStale",
    item: "o/r#40",
    change: "release alice",
    ...over,
});

/** The fact the applier appends when a warning comment lands: seq 0, the snapshot as bytes. */
const warned = (over: Partial<Fact> = {}): Fact => ({
    effectId: ACT,
    seq: 0,
    kind: "warned",
    at: "2026-09-01T00:00:00.000Z",
    revision: "rev-1",
    capability: "inactivity",
    repository: { owner: "o", repo: "r" },
    item: { kind: "issue", number: 40 },
    verb: null,
    login: null,
    code: null,
    detail: null,
    payload: JSON.stringify(snapshot()),
    ...over,
});

describe("the warning a landed comment records", () => {
    it("round-trips every column, and answers null for an act nobody warned", () => {
        const store = new Store(path);

        expect(store.ledger.warningFor(ACT)).toBeNull();
        store.ledger.record(warned());

        // Every field, because the six snapshot columns are what stop a
        // warning authorizing some other capability, item or change (D60):
        // a column silently dropped here would widen that authority.
        expect(store.ledger.warningFor(ACT)).toEqual({ ...snapshot(), effectId: ACT });
        expect(store.ledger.warningFor("some other effect")).toBeNull();
        store.close();
    });

    /** D162: the date the person was told is the date that binds, so a re-record adds nothing. */
    it("keeps one fact per act, and the FIRST promise on it", () => {
        const store = new Store(path);

        store.ledger.record(warned());
        store.ledger.record(
            warned({
                at: "2026-09-05T00:00:00.000Z",
                payload: JSON.stringify(
                    snapshot({
                        warnedAt: "2026-09-05T00:00:00.000Z",
                        earliestActionAt: "2026-09-12T00:00:00.000Z",
                    }),
                ),
            }),
        );

        expect(store.ledger.warningFor(ACT)).toMatchObject({
            warnedAt: "2026-09-01T00:00:00.000Z",
            earliestActionAt: "2026-09-08T00:00:00.000Z",
        });
        expect(store.ledger.factsOf(ACT)).toHaveLength(1);
        store.close();
    });

    it("refuses a fact it could not read back as an instant, or key", () => {
        const store = new Store(path);

        expect(() => store.ledger.record(warned({ at: "yesterday" }))).toThrow(/at/);
        expect(() => store.ledger.record(warned({ effectId: "  " }))).toThrow(/effectId/);
        expect(store.ledger.warningFor(ACT)).toBeNull();
        store.close();
    });

    /** Bytes nobody can read are no promise: the gate is never handed half a snapshot. */
    it("answers null for a payload that is not an object", () => {
        const store = new Store(path);

        store.ledger.record(warned({ payload: "not a snapshot" }));
        expect(store.ledger.warningFor(ACT)).toBeNull();

        store.ledger.record(warned({ effectId: "listed", payload: "[]" }));
        expect(store.ledger.warningFor("listed")).toBeNull();
        store.close();
    });

    /** Retention takes whole effects, so a warned act whose promise has run goes with it (D161, D166). */
    it("prunes an act whose promise has passed the boundary, and keeps a later one", () => {
        const store = new Store(path);
        store.ledger.record(warned());
        store.ledger.record(warned({ effectId: "newer", at: "2026-09-20T00:00:00.000Z" }));

        expect(store.ledger.prune("2026-08-31T23:59:59.999Z")).toBe(0);
        expect(store.ledger.prune("2026-09-07T23:59:59.999Z")).toBe(0);
        expect(store.ledger.prune("2026-09-08T00:00:00.000Z")).toBe(1);
        expect(store.ledger.warningFor(ACT)).toBeNull();
        expect(store.ledger.warningFor("newer")).not.toBeNull();
        store.close();
    });
});
