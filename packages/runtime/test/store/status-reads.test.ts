/**
 * The reads that say what the store holds right now rather than drive work: the
 * queue counted by state, the newest delivery, the sends nothing closed, the
 * warnings still promising, the schedule rows, and the verdicts in a window (D168).
 * The statements that WRITE those rows are `ledger.test.ts`'s and the delivery files'.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useTempDir } from "@hiero-hackers/automation-testkit";
import {
    asDeliveryGuid,
    type DeliveryGuid,
    type ItemRef,
    type RepositoryRef,
} from "@hiero-hackers/automation-core";
import type { Decision, Fact, StoredWarning } from "../../src/store/index.js";
import { Store } from "../../src/store/store.js";

const temp = useTempDir("store-status-reads-");
let store: Store;

beforeEach(() => {
    store = new Store(temp.file("store.sqlite"));
});
afterEach(() => {
    store.close();
});

const ITEM: ItemRef = { kind: "issue", number: 40 };
const REPOSITORY: RepositoryRef = { owner: "o", repo: "r" };
const AT = "2026-09-12T09:00:00.000Z";

/** Earlier than every claim below, so no read here takes a live claim over. */
const STALE = "2026-08-01T00:00:00.000Z";

const GUID_PREFIX = "00000000-0000-0000-0000-00000000000";

function id(raw: string): DeliveryGuid {
    const deliveryId = asDeliveryGuid(raw);
    if (deliveryId === undefined) throw new Error("invalid test delivery GUID");
    return deliveryId;
}

const accept = (last: number, receivedAt: string): DeliveryGuid => {
    const deliveryId = id(`${GUID_PREFIX}${String(last)}`);
    store.inbox.acceptDelivery({
        deliveryId,
        eventName: "issues",
        payload: Buffer.from("work"),
        receivedAt,
    });
    return deliveryId;
};

/** The one eligible pending row, so each delivery below is moved on its own. */
function claim(now: string) {
    const claimed = store.inbox.claimNextDelivery("worker", now, STALE);
    if (claimed === undefined) throw new Error("nothing was claimable");
    return claimed;
}

function complete(now: string, completedAt: string): void {
    const claimed = claim(now);
    store.inbox.completeDelivery({
        deliveryId: claimed.deliveryId,
        eventName: claimed.eventName,
        payloadDigest: claimed.payloadDigest,
        claimToken: claimed.claimToken,
        completedAt,
    });
}

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

const snapshot = (earliestActionAt: string): Omit<StoredWarning, "effectId"> => ({
    warnedAt: AT,
    gracePeriodHours: 7 * 24,
    earliestActionAt,
    cancelledBy: "a commit or a /working comment",
    reversesWith: "re-assign / reopen",
    actionClass: "clockTriggeredDestructive",
    capability: "inactivity",
    causeObservedAt: "2026-08-01T00:00:00.000Z",
    cause: "assignmentWentStale",
    item: "o/r#40",
    change: "release alice",
});

const warned = (effectId: string, earliestActionAt: string): Fact =>
    fact({
        effectId,
        seq: 0,
        kind: "warned",
        verb: null,
        payload: JSON.stringify(snapshot(earliestActionAt)),
    });

const decision = (over: Partial<Decision> = {}): Decision => ({
    passId: "pass-1",
    source: "webhook",
    sourceId: "00000000-0000-0000-0000-000000000001",
    at: AT,
    repository: REPOSITORY,
    item: ITEM,
    capability: "inactivity",
    verdict: "info",
    code: null,
    detail: null,
    effectId: null,
    ...over,
});

describe("the queue counted by state", () => {
    it("counts each state and names the oldest completion still kept", () => {
        accept(1, "2026-08-14T10:00:00.000Z");
        complete("2026-08-14T10:00:01.000Z", "2026-08-14T10:00:05.000Z");
        accept(2, "2026-09-12T14:10:00.000Z");
        const failing = claim("2026-09-12T14:10:01.000Z");
        store.inbox.releaseDeliveryAfterFailure({
            deliveryId: failing.deliveryId,
            claimToken: failing.claimToken,
            failedAt: "2026-09-12T14:10:02.000Z",
            retryNotBefore: "2026-09-12T14:20:00.000Z",
            maxAttempts: 1,
        });
        accept(3, "2026-09-12T14:20:00.000Z");
        claim("2026-09-12T14:20:01.000Z");
        accept(4, "2026-09-12T14:32:10.000Z");
        complete("2026-09-12T14:32:11.000Z", "2026-09-12T14:32:13.000Z");
        accept(5, "2026-09-12T14:00:00.000Z");

        expect(store.inbox.counts()).toEqual({
            pending: 1,
            processing: 1,
            done: 2,
            failed: 1,
            oldestDone: "2026-08-14T10:00:05.000Z",
        });
    });

    it("counts an empty queue without an oldest completion", () => {
        expect(store.inbox.counts()).toEqual({
            pending: 0,
            processing: 0,
            done: 0,
            failed: 0,
            oldestDone: null,
        });
    });
});

describe("the newest delivery received", () => {
    it("is the latest receipt, with the instant its report was committed", () => {
        accept(1, "2026-09-12T14:00:00.000Z");
        complete("2026-09-12T14:00:01.000Z", "2026-09-12T14:00:03.000Z");
        accept(2, "2026-09-12T14:32:10.000Z");
        complete("2026-09-12T14:32:11.000Z", "2026-09-12T14:32:13.000Z");

        expect(store.inbox.newestDelivery()).toEqual({
            receivedAt: "2026-09-12T14:32:10.000Z",
            completedAt: "2026-09-12T14:32:13.000Z",
        });
    });

    it("carries no completion while the newest is still waiting on its decision", () => {
        accept(1, "2026-09-12T14:00:00.000Z");

        expect(store.inbox.newestDelivery()).toEqual({
            receivedAt: "2026-09-12T14:00:00.000Z",
            completedAt: null,
        });
    });

    it("answers nothing on an empty queue", () => {
        expect(store.inbox.newestDelivery()).toBeNull();
    });
});

describe("the sends nothing has closed", () => {
    it("counts the same sends the sweep's worklist is handed, and dates the oldest", () => {
        store.ledger.record(fact({ at: "2026-09-12T13:00:00.000Z" }));
        store.ledger.record(fact({ effectId: "effect-b", at: "2026-09-12T13:30:00.000Z" }));
        store.ledger.record(fact({ effectId: "effect-c", at: "2026-09-12T13:45:00.000Z" }));
        store.ledger.record(
            fact({
                effectId: "effect-c",
                kind: "landed",
                at: "2026-09-12T14:00:00.000Z",
                payload: null,
            }),
        );
        const before = "2026-09-12T23:00:00.000Z";

        expect(store.ledger.stillOpen()).toEqual({
            count: 2,
            oldest: "2026-09-12T13:00:00.000Z",
        });
        expect(store.ledger.open(before).map((send) => send.effectId)).toEqual([
            "effect-a",
            "effect-b",
        ]);
    });

    /** A resend supersedes the send it retries, so two `sent` facts at one seq are one call. */
    it("counts a resent call once, and nothing when no send is open", () => {
        expect(store.ledger.stillOpen()).toEqual({ count: 0, oldest: null });
        store.ledger.record(fact());
        store.ledger.record(fact({ at: "2026-09-12T09:00:01.000Z" }));

        expect(store.ledger.stillOpen()).toEqual({ count: 1, oldest: "2026-09-12T09:00:01.000Z" });
    });
});

describe("the warnings still promising an action", () => {
    it("counts the promises ahead of now and names the earliest", () => {
        store.ledger.record(warned("effect-a", "2026-09-12T16:53:00.000Z"));
        store.ledger.record(warned("effect-b", "2026-09-12T18:00:00.000Z"));

        expect(store.ledger.standingWarnings("2026-09-12T15:00:00.000Z")).toEqual({
            count: 2,
            nextDue: "2026-09-12T16:53:00.000Z",
        });
    });

    it("passes over a promise already due, a kept one, and bytes that are not JSON", () => {
        store.ledger.record(warned("effect-past", "2026-09-12T14:00:00.000Z"));
        store.ledger.record(warned("effect-landed", "2026-09-12T18:00:00.000Z"));
        store.ledger.record(
            fact({ effectId: "effect-landed", kind: "landed", at: AT, payload: null }),
        );
        store.ledger.record(
            fact({ effectId: "effect-bytes", seq: 0, kind: "warned", verb: null, payload: "{" }),
        );

        expect(store.ledger.standingWarnings("2026-09-12T15:00:00.000Z")).toEqual({
            count: 0,
            nextDue: null,
        });
    });
});

describe("the schedule rows as they stand", () => {
    it("names each row, its status, its due time and the claim on it", () => {
        store.ledger.schedule("sweep:o/r", "2026-09-12T15:32:39.000Z", "sweep");
        store.ledger.schedule("sweep:o/other", "2026-09-12T16:00:00.000Z", "sweep");

        expect(store.ledger.schedules()).toEqual([
            {
                scheduleId: "sweep:o/other",
                dueAt: "2026-09-12T16:00:00.000Z",
                effect: "sweep",
                status: "pending",
                claimedAt: null,
            },
            {
                scheduleId: "sweep:o/r",
                dueAt: "2026-09-12T15:32:39.000Z",
                effect: "sweep",
                status: "pending",
                claimedAt: null,
            },
        ]);
    });

    it("carries the claim instant while a firing holds the row, and nothing before one", () => {
        expect(store.ledger.schedules()).toEqual([]);
        store.ledger.schedule("sweep:o/r", "2026-09-12T15:32:39.000Z", "sweep");
        store.ledger.claimDue("2026-09-12T16:00:00.000Z");

        expect(store.ledger.schedules()[0]).toMatchObject({
            status: "running",
            claimedAt: "2026-09-12T16:00:00.000Z",
        });
    });
});

describe("the verdicts a window holds", () => {
    it("counts each verdict after the cutoff, in verdict order", () => {
        store.ledger.decide(decision({ verdict: "refused" }));
        store.ledger.decide(decision({ verdict: "info" }));
        store.ledger.decide(decision({ verdict: "info" }));
        store.ledger.decide(decision({ verdict: "notice" }));
        store.ledger.decide(decision({ at: "2026-09-11T08:00:00.000Z", verdict: "problem" }));

        expect(store.ledger.verdictsSince("2026-09-11T09:00:00.000Z")).toEqual([
            { verdict: "info", count: 2 },
            { verdict: "notice", count: 1 },
            { verdict: "refused", count: 1 },
        ]);
    });

    it("counts nothing when the window holds no decision", () => {
        store.ledger.decide(decision());

        expect(store.ledger.verdictsSince(AT)).toEqual([]);
    });
});
