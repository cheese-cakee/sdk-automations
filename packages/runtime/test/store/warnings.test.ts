/**
 * The `destructive_warning` table: one row per act, written when that act's
 * warning comment lands and read back when the act next asks (grace.md §4).
 *
 * A one-row upsert has no interleaving to model and no ordering to check —
 * everything it can do is here, in one file: what a row round-trips as, what a
 * second write does to it, what an unreadable instant costs, and what
 * retention takes away. The MIGRATION that adds the table is `schema.test.ts`'s
 * — every old version is upgraded into the fingerprint a fresh database
 * creates, and that fingerprint now names this table.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { useTempDir } from "@hiero-hackers/automation-testkit";
import { Store } from "../../src/store/store.js";
import type { StoredWarning } from "../../src/store/index.js";

const temp = useTempDir("store-warnings-");
let path: string;

beforeEach(() => {
    path = temp.file("store.sqlite");
});

const ACT =
    '["inactivity","o","r","issue","40","releaseAssignment","assignmentWentStale","2026-08-01T00:00:00.000Z"]';

const warning = (over: Partial<StoredWarning> = {}): StoredWarning => ({
    effectId: ACT,
    warnedAt: "2026-09-01T00:00:00.000Z",
    gracePeriodDays: 7,
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

describe("the warning a landed comment records", () => {
    it("round-trips every column, and answers null for an act nobody warned", () => {
        const store = new Store(path);

        expect(store.warning(ACT)).toBeNull();
        store.recordWarning(warning());

        // Every field, because the six snapshot columns are what stop a
        // warning authorizing some other capability, item or change (D60):
        // a column silently dropped here would widen that authority.
        expect(store.warning(ACT)).toEqual(warning());
        expect(store.warning("some other effect")).toBeNull();
        store.close();
    });

    it("keeps one row per act, and the newest promise on it", () => {
        const store = new Store(path);

        store.recordWarning(warning());
        store.recordWarning(
            warning({
                warnedAt: "2026-09-05T00:00:00.000Z",
                earliestActionAt: "2026-09-12T00:00:00.000Z",
            }),
        );

        expect(store.warning(ACT)).toMatchObject({
            warnedAt: "2026-09-05T00:00:00.000Z",
            earliestActionAt: "2026-09-12T00:00:00.000Z",
        });
        expect(
            (
                store as unknown as {
                    db: { prepare(sql: string): { all(): unknown[] } };
                }
            ).db
                .prepare("SELECT effect_id FROM destructive_warning")
                .all(),
        ).toHaveLength(1);
        store.close();
    });

    it("refuses a row it could not read back as an instant, or key", () => {
        const store = new Store(path);

        expect(() => store.recordWarning(warning({ warnedAt: "yesterday" }))).toThrow(/warnedAt/);
        expect(() => store.recordWarning(warning({ earliestActionAt: "soon" }))).toThrow(
            /earliestActionAt/,
        );
        expect(() => store.recordWarning(warning({ causeObservedAt: "then" }))).toThrow(
            /causeObservedAt/,
        );
        expect(() => store.recordWarning(warning({ effectId: "  " }))).toThrow(/effectId/);
        expect(store.warning(ACT)).toBeNull();
        store.close();
    });

    it("prunes by when the promise was made, and validates the boundary", () => {
        const store = new Store(path);
        store.recordWarning(warning());
        store.recordWarning(warning({ effectId: "newer", warnedAt: "2026-09-20T00:00:00.000Z" }));

        expect(() => store.pruneWarnings("whenever")).toThrow(/before/);
        expect(store.pruneWarnings("2026-08-31T23:59:59.999Z")).toBe(0);
        expect(store.pruneWarnings("2026-09-01T00:00:00.000Z")).toBe(1);
        expect(store.warning(ACT)).toBeNull();
        expect(store.warning("newer")).not.toBeNull();
        store.close();
    });
});
