/**
 * A warning read back from its own comment: the App's marker and GitHub's date make a `warned`
 * row; a copy, an undated comment or a bare marker make none; the first record binds.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    deriveManagedMarker,
    type CommentFact,
    type ReadBack,
    type WarningRecord,
} from "@hiero-hackers/automation-core";
import { Store } from "../../../src/store/index.js";
import { hydrateWarnings } from "../../../src/shell/decide/warnings.js";

const REPOSITORY = { owner: "o", repo: "r" } as const;
const ITEM = { kind: "issue", number: 12 } as const;
const CREATED = "2026-10-01T10:00:00Z";

const record: WarningRecord = {
    effectId: "inactivity:issue#12:release:ada",
    actionClass: "clockTriggeredDestructive",
    capability: "inactivity",
    causeObservedAt: "2026-09-01T00:00:00.000Z",
    cause: "assignmentWentStale",
    item: "issue#12",
    change: "unassign ada",
    gracePeriodHours: 168,
    cancelledBy: "a comment by ada",
    reversesWith: "assigning ada again",
};

const identity = { capability: "inactivity", item: ITEM, kind: "warning", topic: "ada" } as const;

const warning = (
    overrides: Partial<CommentFact> = {},
    carried: WarningRecord = record,
): CommentFact => ({
    id: 1,
    body: `${deriveManagedMarker(identity, carried)}\n\nada, this issue has been idle.`,
    authoredByApp: true,
    createdAt: CREATED,
    ...overrides,
});

const readerOf = (comments: readonly CommentFact[]): ReadBack =>
    ({ comments: () => Promise.resolve({ ok: true, value: comments }) }) as unknown as ReadBack;

let store: Store;
beforeEach(() => {
    store = new Store(":memory:");
});
afterEach(() => {
    store.close();
});

const hydrate = (comments: readonly CommentFact[]) =>
    hydrateWarnings({
        ledger: store.ledger,
        reader: readerOf(comments),
        repository: REPOSITORY,
        item: ITEM,
        revision: "rev-1",
    });

describe("warnings read back from an item's comments", () => {
    it("records the act's warning, dated when GitHub says the comment appeared", async () => {
        expect(await hydrate([warning()])).toBe(1);
        expect(store.ledger.warningFor(record.effectId)).toEqual({
            effectId: record.effectId,
            warnedAt: "2026-10-01T10:00:00.000Z",
            gracePeriodHours: 168,
            earliestActionAt: "2026-10-08T10:00:00.000Z",
            cancelledBy: record.cancelledBy,
            reversesWith: record.reversesWith,
            actionClass: record.actionClass,
            capability: record.capability,
            causeObservedAt: record.causeObservedAt,
            cause: record.cause,
            item: record.item,
            change: record.change,
        });
    });

    it("ignores a copy under a person's name, an undated comment and a bare marker", async () => {
        const bare = warning({ id: 3, body: deriveManagedMarker(identity) });
        const { createdAt: _dated, ...undated } = warning({ id: 2 });
        const copy = warning({ id: 4, authoredByApp: false });
        const misdated = warning({ id: 6, createdAt: "not a date" });
        expect(await hydrate([copy, undated, bare, misdated])).toBe(0);
        expect(store.ledger.warningFor(record.effectId)).toBeNull();
    });

    it("dates a warning rewritten in place at its rewrite, never earlier than its creation", async () => {
        expect(await hydrate([warning({ updatedAt: "2026-10-05T10:00:00Z" })])).toBe(1);
        expect(store.ledger.warningFor(record.effectId)).toMatchObject({
            warnedAt: "2026-10-05T10:00:00.000Z",
            earliestActionAt: "2026-10-12T10:00:00.000Z",
        });
        store.close();
        store = new Store(":memory:");
        await hydrate([warning({ updatedAt: "2026-09-30T10:00:00Z" })]);
        expect(store.ledger.warningFor(record.effectId)?.warnedAt).toBe("2026-10-01T10:00:00.000Z");
    });

    it("keeps the first record for an effect when a later comment carries the same one", async () => {
        await hydrate([warning()]);
        await hydrate([warning({ id: 5, createdAt: "2026-10-03T10:00:00Z" })]);
        expect(store.ledger.warningFor(record.effectId)?.warnedAt).toBe("2026-10-01T10:00:00.000Z");
    });

    it("answers nothing when the comments cannot be read", async () => {
        const reader = {
            comments: () => Promise.resolve({ ok: false, detail: "GitHub answered 502" }),
        } as unknown as ReadBack;
        const offered = await hydrateWarnings({
            ledger: store.ledger,
            reader,
            repository: REPOSITORY,
            item: ITEM,
            revision: "rev-1",
        });
        expect(offered).toBe(0);
    });
});
