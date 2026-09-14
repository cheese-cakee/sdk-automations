/**
 * The delivery's only completion boundary: `done`, under one claim token.
 * Worker exits exercise SQLite recovery with independent connections rather
 * than sequential promises posing as contention.
 */

import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import { beforeEach, describe, expect, it } from "vitest";
import { asDeliveryGuid } from "@hiero-hackers/automation-core";
import { useTempDir } from "@hiero-hackers/automation-testkit";
import { Store } from "../../src/store/store.js";
import type { ClaimedDelivery, CompleteDeliveryInput } from "../../src/store/deliveries.js";
import { buildWorkerStoreModule } from "./worker-build.js";

const temp = useTempDir("delivery-finalization-");
let databasePath: string;

beforeEach(() => {
    databasePath = temp.file("store.sqlite");
});

const DELIVERY_ID = asDeliveryGuid("00000000-0000-0000-0000-000000000001")!;
const SECOND_DELIVERY_ID = asDeliveryGuid("00000000-0000-0000-0000-000000000002")!;
const THIRD_DELIVERY_ID = asDeliveryGuid("00000000-0000-0000-0000-000000000003")!;
const RECEIVED_AT = "2026-08-01T10:00:00.000Z";
const COMPLETED_AT = "2026-08-01T10:02:00.000Z";

function acceptAndClaim(store: Store, deliveryId = DELIVERY_ID): ClaimedDelivery {
    store.inbox.acceptDelivery({
        deliveryId,
        eventName: "issues",
        payload: Buffer.from("work"),
        receivedAt: RECEIVED_AT,
    });
    return store.inbox.claimNextDelivery(
        "worker-a",
        "2026-08-01T10:01:00.000Z",
        "2026-08-01T09:00:00.000Z",
    )!;
}

function completion(
    claim: ClaimedDelivery,
    overrides: Partial<CompleteDeliveryInput> = {},
): CompleteDeliveryInput {
    return {
        deliveryId: claim.deliveryId,
        eventName: claim.eventName,
        payloadDigest: claim.payloadDigest,
        claimToken: claim.claimToken,
        completedAt: COMPLETED_AT,
        ...overrides,
    };
}

/** The delivery row as a reopened connection reads it, which is the only durable outcome. */
function durableDelivery(): Record<string, unknown> {
    const db = new DatabaseSync(databasePath);
    const delivery = db
        .prepare(
            `
        SELECT state, payload, claim_token, completed_at
        FROM seen_delivery WHERE delivery_id = ?
    `,
        )
        .get(DELIVERY_ID) as Record<string, unknown>;
    db.close();
    return delivery;
}

const FINALIZER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");

(async () => {
    const { Store } = await import(workerData.storeModule);
    const store = new Store(workerData.databasePath, {
        injectFault(point) {
            if (point === workerData.faultPoint) process.exit(23);
        },
    });
    const gate = new Int32Array(workerData.gate);
    parentPort.postMessage({ type: "ready" });
    Atomics.wait(gate, 0, 0);
    const value = store.inbox.completeDelivery(workerData.input);
    store.close();
    parentPort.postMessage({ type: "result", value });
})().catch((error) => {
    parentPort.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "worker failed",
    });
});
`;

interface WorkerOutcome {
    readonly value?: { readonly outcome: string };
    readonly exitCode?: number;
}

async function runFinalizers(
    work: ReadonlyArray<{
        readonly input: CompleteDeliveryInput;
        readonly faultPoint?: string;
    }>,
): Promise<WorkerOutcome[]> {
    const storeModule = buildWorkerStoreModule(temp.dir);
    const gate = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    const gateView = new Int32Array(gate);
    let ready = 0;
    const workers: Worker[] = [];

    const results = work.map(
        (item) =>
            new Promise<WorkerOutcome>((resolve, reject) => {
                const worker = new Worker(FINALIZER_SOURCE, {
                    eval: true,
                    workerData: {
                        storeModule,
                        databasePath,
                        gate,
                        input: item.input,
                        faultPoint: item.faultPoint,
                    },
                });
                workers.push(worker);
                let settled = false;
                worker.on("error", reject);
                worker.on(
                    "message",
                    (message: {
                        type: "ready" | "result" | "error";
                        value?: { outcome: string };
                        message?: string;
                    }) => {
                        if (message.type === "ready") {
                            ready++;
                            if (ready === work.length) {
                                Atomics.store(gateView, 0, 1);
                                Atomics.notify(gateView, 0, work.length);
                            }
                        } else if (message.type === "error") {
                            reject(new Error(message.message ?? "worker failed"));
                        } else {
                            if (message.value === undefined) {
                                reject(new Error("worker returned no result"));
                                return;
                            }
                            settled = true;
                            resolve({ value: message.value });
                        }
                    },
                );
                worker.on("exit", (exitCode) => {
                    if (!settled) resolve({ exitCode });
                });
            }),
    );

    try {
        return await Promise.all(results);
    } finally {
        await Promise.all(workers.map((worker) => worker.terminate()));
    }
}

describe("atomic completion", () => {
    it("commits done and gives up the payload, then retries idempotently", () => {
        const store = new Store(databasePath);
        const claim = acceptAndClaim(store);
        const input = completion(claim);

        expect(store.inbox.completeDelivery(input)).toEqual({ outcome: "completed" });
        expect(
            store.inbox.completeDelivery({
                ...input,
                completedAt: "2026-08-01T10:03:00.000Z",
            }),
        ).toEqual({ outcome: "alreadyCompleted" });
        store.close();

        // The retry changed nothing: the first commit's instant is the one kept.
        expect(durableDelivery()).toEqual({
            state: "done",
            payload: null,
            claim_token: null,
            completed_at: COMPLETED_AT,
        });
    });

    it("rejects released claims, mismatched identities, and a never-claimed delivery", () => {
        const store = new Store(databasePath);
        const released = acceptAndClaim(store);
        expect(store.inbox.releaseDelivery(DELIVERY_ID, released.claimToken)).toEqual({
            outcome: "released",
        });
        // Early: the row is back to pending, so no token owns it.
        expect(store.inbox.completeDelivery(completion(released))).toEqual({
            outcome: "notOwned",
        });

        const current = store.inbox.claimNextDelivery(
            "worker-b",
            "2026-08-01T10:01:30.000Z",
            "2026-08-01T09:00:00.000Z",
        )!;
        expect(
            store.inbox.completeDelivery(completion(current, { eventName: "pull_request" })),
        ).toEqual({ outcome: "identityMismatch" });
        expect(
            store.inbox.completeDelivery(completion(current, { payloadDigest: "1".repeat(64) })),
        ).toEqual({ outcome: "identityMismatch" });
        expect(
            store.inbox.completeDelivery(completion(current, { deliveryId: SECOND_DELIVERY_ID })),
        ).toEqual({ outcome: "identityMismatch" });
        // A stale token cannot take the completion off the current one.
        expect(store.inbox.completeDelivery(completion(current, { claimToken: "stale" }))).toEqual({
            outcome: "notOwned",
        });
        expect(store.inbox.completeDelivery(completion(current))).toEqual({
            outcome: "completed",
        });
        store.close();

        expect(durableDelivery()).toMatchObject({ state: "done" });
    });

    it("fails closed on malformed completion inputs", () => {
        const store = new Store(databasePath);
        const claim = acceptAndClaim(store);
        const input = completion(claim);

        expect(() =>
            store.inbox.completeDelivery({ ...input, payloadDigest: "not-a-digest" }),
        ).toThrow(/payloadDigest/);
        expect(() =>
            store.inbox.completeDelivery({
                ...input,
                payloadDigest: `${claim.payloadDigest}0`,
            }),
        ).toThrow("payloadDigest must be a lowercase SHA-256 digest");
        expect(() => store.inbox.completeDelivery({ ...input, eventName: "" })).toThrow(
            "eventName must be a non-empty string",
        );
        expect(() =>
            store.inbox.completeDelivery({
                ...input,
                deliveryId: "not-a-guid" as typeof input.deliveryId,
            }),
        ).toThrow("deliveryId must be a valid GitHub delivery GUID");
        expect(() =>
            store.inbox.releaseDelivery("not-a-guid" as typeof input.deliveryId, claim.claimToken),
        ).toThrow("deliveryId must be a valid GitHub delivery GUID");
        store.close();
    });

    /**
     * The token is not kept past the commit, so a completed delivery can only
     * say that it finished — to the worker that committed it and to the one
     * whose claim was taken away alike (D173).
     */
    it("tells every later token that the delivery already completed", () => {
        const store = new Store(databasePath);
        const claim = acceptAndClaim(store);
        const input = completion(claim);
        expect(store.inbox.completeDelivery(input)).toEqual({ outcome: "completed" });
        expect(
            store.inbox.completeDelivery({ ...input, claimToken: "a-different-claim-token" }),
        ).toEqual({ outcome: "alreadyCompleted" });
        expect(store.inbox.completeDelivery(input)).toEqual({ outcome: "alreadyCompleted" });
        store.close();
    });

    it("rolls back when the owned delivery invariant is damaged", () => {
        const store = new Store(databasePath);
        const claim = acceptAndClaim(store);
        const db = (store as unknown as { db: DatabaseSync }).db;
        db.exec("PRAGMA ignore_check_constraints = ON");
        db.prepare("UPDATE seen_delivery SET state = 'pending' WHERE delivery_id = ?").run(
            DELIVERY_ID,
        );

        expect(() => store.inbox.completeDelivery(completion(claim))).toThrow(
            "delivery ownership changed under its write transaction",
        );
        store.close();

        expect(durableDelivery()).toMatchObject({ state: "pending", completed_at: null });
    });

    it("prunes a completed delivery at its retention boundary", () => {
        const store = new Store(databasePath);
        const claim = acceptAndClaim(store);
        expect(store.inbox.completeDelivery(completion(claim))).toEqual({ outcome: "completed" });
        expect(store.inbox.pruneCompletedDeliveries(COMPLETED_AT)).toBe(1);
        store.close();

        const db = new DatabaseSync(databasePath);
        expect(db.prepare("SELECT count(*) AS count FROM seen_delivery").get()).toEqual({
            count: 0,
        });
        db.close();
    });
});

describe("dead-lettering", () => {
    /** One failed attempt against a claim, spending a two-attempt budget. */
    function fail(store: Store, claim: ClaimedDelivery, failedAt: string) {
        return store.inbox.releaseDeliveryAfterFailure({
            deliveryId: claim.deliveryId,
            claimToken: claim.claimToken,
            failedAt,
            retryNotBefore: failedAt,
            maxAttempts: 2,
        });
    }

    it("stops claiming a delivery at its cap and keeps it inspectable", () => {
        const store = new Store(databasePath);
        const first = acceptAndClaim(store);
        expect(fail(store, first, "2026-08-01T10:01:10.000Z")).toEqual({
            outcome: "retryScheduled",
            attempts: 1,
            retryNotBefore: "2026-08-01T10:01:10.000Z",
        });

        const second = store.inbox.claimNextDelivery(
            "worker-a",
            "2026-08-01T10:01:20.000Z",
            "2026-08-01T09:00:00.000Z",
        )!;
        expect(second.attempts).toBe(1);
        expect(fail(store, second, COMPLETED_AT)).toEqual({
            outcome: "deadLettered",
            attempts: 2,
        });

        // Claimable by no worker, at any later instant, stale window included.
        expect(
            store.inbox.claimNextDelivery(
                "worker-b",
                "2026-09-01T00:00:00.000Z",
                "2026-08-31T00:00:00.000Z",
            ),
        ).toBeUndefined();
        expect(store.inbox.deadLetteredDeliveries()).toEqual([
            {
                deliveryId: DELIVERY_ID,
                eventName: "issues",
                payloadDigest: first.payloadDigest,
                receivedAt: RECEIVED_AT,
                attempts: 2,
                failedAt: COMPLETED_AT,
            },
        ]);
        // Still the same delivery to a redelivery, and never pruned as done.
        expect(
            store.inbox.acceptDelivery({
                deliveryId: DELIVERY_ID,
                eventName: "issues",
                payload: Buffer.from("work"),
                receivedAt: RECEIVED_AT,
            }),
        ).toMatchObject({ outcome: "duplicate", state: "failed" });
        expect(store.inbox.pruneCompletedDeliveries("2026-12-01T00:00:00.000Z")).toBe(0);
        store.close();

        // The bytes a redrive would need outlive the failure, unlike a
        // completed delivery's, which completion clears.
        const db = new DatabaseSync(databasePath);
        const row = db
            .prepare("SELECT state, payload, completed_at FROM seen_delivery WHERE delivery_id = ?")
            .get(DELIVERY_ID) as Record<string, unknown>;
        expect(row.state).toBe("failed");
        expect(row.completed_at).toBe(COMPLETED_AT);
        expect(Buffer.from(row.payload as Uint8Array)).toEqual(Buffer.from("work"));
        db.close();
    });

    it("lists dead letters in dead-letter time then delivery identity", () => {
        const store = new Store(databasePath);
        for (const [deliveryId, failedAt] of [
            [THIRD_DELIVERY_ID, "2026-08-01T10:04:00.000Z"],
            [DELIVERY_ID, "2026-08-01T10:05:00.000Z"],
            [SECOND_DELIVERY_ID, "2026-08-01T10:04:00.000Z"],
        ] as const) {
            const claim = acceptAndClaim(store, deliveryId);
            expect(
                store.inbox.releaseDeliveryAfterFailure({
                    deliveryId,
                    claimToken: claim.claimToken,
                    failedAt,
                    retryNotBefore: failedAt,
                    maxAttempts: 1,
                }),
            ).toEqual({ outcome: "deadLettered", attempts: 1 });
        }

        expect(store.inbox.deadLetteredDeliveries().map((entry) => entry.deliveryId)).toEqual([
            SECOND_DELIVERY_ID,
            THIRD_DELIVERY_ID,
            DELIVERY_ID,
        ]);
        store.close();
    });

    it("atomically redrives only a dead letter with a fresh attempt budget", () => {
        const store = new Store(databasePath);
        const first = acceptAndClaim(store);
        expect(fail(store, first, COMPLETED_AT)).toMatchObject({ outcome: "retryScheduled" });
        const second = store.inbox.claimNextDelivery("worker-a", COMPLETED_AT, RECEIVED_AT)!;
        expect(fail(store, second, COMPLETED_AT)).toEqual({
            outcome: "deadLettered",
            attempts: 2,
        });

        expect(store.inbox.redriveDelivery(SECOND_DELIVERY_ID)).toBe(false);
        expect(store.inbox.redriveDelivery(DELIVERY_ID)).toBe(true);
        expect(store.inbox.redriveDelivery(DELIVERY_ID)).toBe(false);
        expect(store.inbox.deadLetteredDeliveries()).toEqual([]);

        const redriven = store.inbox.claimNextDelivery("worker-b", COMPLETED_AT, RECEIVED_AT)!;
        expect(redriven.deliveryId).toBe(DELIVERY_ID);
        expect(redriven.attempts).toBe(0);
        expect(Buffer.from(redriven.payload)).toEqual(Buffer.from("work"));
        store.close();
    });
});

describe("crash boundaries", () => {
    it.each(["finalize:deliveryCompleted", "finalize:committed"] as const)(
        "a thrown fault at %s exposes the same rollback-or-commit boundary in-process",
        (faultPoint) => {
            let faulted = false;
            const store = new Store(databasePath, {
                injectFault: (point) => {
                    if (point === faultPoint && !faulted) {
                        faulted = true;
                        throw new Error(`fault ${point}`);
                    }
                },
            });
            const claim = acceptAndClaim(store);

            expect(() => store.inbox.completeDelivery(completion(claim))).toThrow(
                `fault ${faultPoint}`,
            );
            const committed = faultPoint === "finalize:committed";
            expect(store.inbox.completeDelivery(completion(claim))).toEqual({
                outcome: committed ? "alreadyCompleted" : "completed",
            });
            store.close();

            expect(durableDelivery().state).toBe("done");
        },
    );

    it.each([
        ["finalize:deliveryCompleted", "processing"],
        ["finalize:committed", "done"],
    ] as const)("a worker exit at %s leaves neither outcome or both", async (faultPoint, state) => {
        const setup = new Store(databasePath);
        const claim = acceptAndClaim(setup);
        setup.close();

        expect(await runFinalizers([{ input: completion(claim), faultPoint }])).toEqual([
            { exitCode: 23 },
        ]);
        expect(durableDelivery().state).toBe(state);

        const restarted = new Store(databasePath);
        expect(restarted.inbox.completeDelivery(completion(claim))).toEqual({
            outcome: state === "done" ? "alreadyCompleted" : "completed",
        });
        restarted.close();
    });
});

describe("claim ownership under contention", () => {
    /** The instant each racing worker would stamp, so the committed row names the winner. */
    const OLD_AT = "2026-08-01T10:30:00.000Z";
    const CURRENT_AT = "2026-08-01T10:31:00.000Z";

    it("lets only the current token finalize across real worker threads", async () => {
        const firstStore = new Store(databasePath);
        const first = acceptAndClaim(firstStore);
        firstStore.close();

        const secondStore = new Store(databasePath);
        const second = secondStore.inbox.claimNextDelivery(
            "worker-b",
            "2026-08-01T10:20:00.000Z",
            "2026-08-01T10:01:00.000Z",
        )!;
        secondStore.close();

        const outcomes = await runFinalizers([
            { input: completion(first, { completedAt: OLD_AT }) },
            { input: completion(second, { completedAt: CURRENT_AT }) },
        ]);
        // The retired token loses either way: it finds the current claim in
        // front of it, or the completion that claim already committed.
        expect(outcomes.filter((result) => result.value?.outcome === "completed")).toHaveLength(1);
        expect(outcomes.map((result) => result.value?.outcome)).toContainEqual(
            expect.stringMatching(/^(notOwned|alreadyCompleted)$/),
        );

        expect(durableDelivery()).toMatchObject({
            state: "done",
            completed_at: CURRENT_AT,
        });
    });
});
