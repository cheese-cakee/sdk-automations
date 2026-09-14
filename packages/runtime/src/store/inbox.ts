/**
 * The delivery queue: which row may move to which state, on whose claim token.
 * A queue mutates in place, which is what makes it the ledger's opposite (D164).
 * Acceptance and completion use explicit synchronous transactions, so a
 * returned outcome always describes committed rows.
 */

import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { asDeliveryGuid, type DeliveryGuid } from "@hiero-hackers/automation-core";
import type {
    AcceptDeliveryInput,
    AcceptDeliveryResult,
    ClaimedDelivery,
    CompleteDeliveryInput,
    CompleteDeliveryResult,
    DeadLetteredDelivery,
    DeliveryCounts,
    DeliveryState,
    NewestDelivery,
    ReleaseDeliveryAfterFailureInput,
    ReleaseDeliveryAfterFailureResult,
    ReleaseDeliveryResult,
} from "./deliveries.js";
import { assertNonEmpty, assertUtcInstant } from "./guards.js";

/** A deliberate interruption point in delivery durability work. */
export type DeliveryFaultPoint =
    "intake:accepted" | "finalize:deliveryCompleted" | "finalize:committed";

function assertDeliveryGuid(value: DeliveryGuid): void {
    if (asDeliveryGuid(value) === undefined) {
        throw new TypeError("deliveryId must be a valid GitHub delivery GUID");
    }
}

function assertPayload(value: Uint8Array): void {
    if (!(value instanceof Uint8Array)) {
        throw new TypeError("payload must be bytes");
    }
}

function assertPayloadDigest(value: string): void {
    if (value.length !== 64 || !/^[a-f0-9]+$/.test(value)) {
        throw new TypeError("payloadDigest must be a lowercase SHA-256 digest");
    }
}

function assertAttemptCap(value: number): void {
    if (!Number.isInteger(value) || value < 1) {
        throw new TypeError("maxAttempts must be a positive integer");
    }
}

function payloadDigest(payload: Uint8Array): string {
    return createHash("sha256").update(payload).digest("hex");
}

interface StoredDeliveryIdentity {
    readonly event_name: string;
    readonly payload_digest: string;
    readonly state: DeliveryState;
}

interface ClaimedDeliveryRow {
    readonly delivery_id: string;
    readonly event_name: string;
    readonly payload: Uint8Array;
    readonly payload_digest: string;
    readonly received_at: string;
    readonly claim_token: string;
    readonly attempts: number;
}

interface FailedAttemptRow {
    readonly state: DeliveryState;
    readonly attempts: number;
    readonly retry_not_before: string | null;
}

interface DeadLetteredDeliveryRow {
    readonly delivery_id: string;
    readonly event_name: string;
    readonly payload_digest: string;
    readonly received_at: string;
    readonly attempts: number;
    readonly completed_at: string;
}

interface DeliveryFinalizationRow {
    readonly event_name: string;
    readonly payload_digest: string;
    readonly state: DeliveryState;
    readonly claim_token: string | null;
}

interface DeliveryCountsRow {
    readonly pending: number;
    readonly processing: number;
    readonly done: number;
    readonly failed: number;
    readonly oldest_done: string | null;
}

interface NewestDeliveryRow {
    readonly received_at: string;
    readonly completed_at: string | null;
}

/**
 * Why this completion may not commit, or `undefined` when it may.
 * Identity is checked first, so a delivery never accepted and one offered the wrong digest answer alike.
 */
function refusedCompletion(
    delivery: DeliveryFinalizationRow | undefined,
    input: CompleteDeliveryInput,
): Exclude<CompleteDeliveryResult, { outcome: "completed" }> | undefined {
    if (
        delivery === undefined ||
        delivery.event_name !== input.eventName ||
        delivery.payload_digest !== input.payloadDigest
    ) {
        return { outcome: "identityMismatch" };
    }
    if (delivery.state === "done") return { outcome: "alreadyCompleted" };
    if (delivery.claim_token !== input.claimToken) return { outcome: "notOwned" };
    return undefined;
}

/** One delivery's durable life, from verified bytes to retention (D164). */
export class Inbox {
    private readonly db: DatabaseSync;
    private readonly injectFault: (point: DeliveryFaultPoint) => void;

    constructor(db: DatabaseSync, injectFault: (point: DeliveryFaultPoint) => void) {
        this.db = db;
        this.injectFault = injectFault;
    }

    // ── Durable webhook intake ─────────────────────────────────────

    /**
     * Atomically persist a verified delivery's identity and exact bytes before a
     * receiver acknowledges it. Neither a duplicate nor a conflict mutates the first.
     */
    acceptDelivery(input: AcceptDeliveryInput): AcceptDeliveryResult {
        assertDeliveryGuid(input.deliveryId);
        assertNonEmpty(input.eventName, "eventName");
        assertPayload(input.payload);
        assertUtcInstant(input.receivedAt, "receivedAt");

        const digest = payloadDigest(input.payload);
        this.db.exec("BEGIN IMMEDIATE");
        try {
            const inserted = this.db
                .prepare(
                    `
                    INSERT INTO seen_delivery (
                        delivery_id, event_name, payload, payload_digest,
                        received_at, state, claim_worker, claim_token,
                        claimed_at, completed_at, attempts, retry_not_before
                    ) VALUES (?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, NULL, 0, NULL)
                    ON CONFLICT(delivery_id) DO NOTHING
                `,
                )
                .run(input.deliveryId, input.eventName, input.payload, digest, input.receivedAt);

            let result: AcceptDeliveryResult;
            if (inserted.changes === 1) {
                result = {
                    outcome: "accepted",
                    state: "pending",
                    payloadDigest: digest,
                };
            } else {
                const existing = this.db
                    .prepare(
                        `
                        SELECT event_name, payload_digest, state
                        FROM seen_delivery
                        WHERE delivery_id = ?
                    `,
                    )
                    .get(input.deliveryId) as unknown as StoredDeliveryIdentity;

                const eventNameMismatch = existing.event_name !== input.eventName;
                const payloadMismatch = existing.payload_digest !== digest;
                result =
                    eventNameMismatch || payloadMismatch
                        ? {
                              outcome: "conflict",
                              state: existing.state,
                              eventNameMismatch,
                              payloadMismatch,
                          }
                        : {
                              outcome: "duplicate",
                              state: existing.state,
                              payloadDigest: existing.payload_digest,
                          };
            }

            this.injectFault("intake:accepted");
            this.db.exec("COMMIT");
            return result;
        } catch (error) {
            try {
                this.db.exec("ROLLBACK");
            } catch {
                // Preserve the operation's original error.
            }
            throw error;
        }
    }

    /**
     * Claim the oldest ELIGIBLE delivery, or atomically take over one stale claim.
     * The generated token, not the worker name, proves ownership. Eligibility skips a row waiting out a backoff and a dead-lettered one, inside the claiming statement.
     */
    claimNextDelivery(
        worker: string,
        now: string,
        staleBefore: string,
    ): ClaimedDelivery | undefined {
        assertNonEmpty(worker, "worker");
        assertUtcInstant(now, "now");
        assertUtcInstant(staleBefore, "staleBefore");
        const row = this.db
            .prepare(
                `
                UPDATE seen_delivery
                SET state = 'processing',
                    claim_worker = ?,
                    claim_token = lower(hex(randomblob(32))),
                    claimed_at = ?,
                    retry_not_before = NULL
                WHERE delivery_id = (
                    SELECT delivery_id
                    FROM seen_delivery
                    WHERE (state = 'pending'
                            AND (retry_not_before IS NULL OR retry_not_before <= ?))
                       OR (state = 'processing' AND claimed_at <= ?)
                    ORDER BY received_at, delivery_id
                    LIMIT 1
                )
                RETURNING delivery_id, event_name, payload, payload_digest,
                          received_at, claim_token, attempts
            `,
            )
            .get(worker, now, now, staleBefore) as ClaimedDeliveryRow | undefined;
        if (row === undefined) return undefined;
        return {
            deliveryId: row.delivery_id as DeliveryGuid,
            eventName: row.event_name,
            payload: Buffer.from(row.payload),
            payloadDigest: row.payload_digest,
            receivedAt: row.received_at,
            worker,
            claimedAt: now,
            claimToken: row.claim_token,
            attempts: row.attempts,
        };
    }

    /**
     * Complete only this token's current claim, in one transaction (D173).
     * A delivery already done answers `alreadyCompleted` whatever token asks: the
     * committing token is not kept, so the store knows only that it finished.
     */
    completeDelivery(input: CompleteDeliveryInput): CompleteDeliveryResult {
        assertDeliveryGuid(input.deliveryId);
        assertNonEmpty(input.eventName, "eventName");
        assertPayloadDigest(input.payloadDigest);
        assertNonEmpty(input.claimToken, "claimToken");
        assertUtcInstant(input.completedAt, "completedAt");

        this.db.exec("BEGIN IMMEDIATE");
        try {
            const delivery = this.db
                .prepare(
                    `
                SELECT event_name, payload_digest, state, claim_token
                FROM seen_delivery
                WHERE delivery_id = ?
            `,
                )
                .get(input.deliveryId) as DeliveryFinalizationRow | undefined;

            const refusal = refusedCompletion(delivery, input);
            if (refusal !== undefined) {
                this.db.exec("ROLLBACK");
                return refusal;
            }

            const completed = this.db
                .prepare(
                    `
                UPDATE seen_delivery
                SET state = 'done', payload = NULL, claim_worker = NULL,
                    claim_token = NULL, claimed_at = NULL, completed_at = ?
                WHERE delivery_id = ? AND event_name = ? AND payload_digest = ?
                  AND state = 'processing' AND claim_token = ?
            `,
                )
                .run(
                    input.completedAt,
                    input.deliveryId,
                    input.eventName,
                    input.payloadDigest,
                    input.claimToken,
                );
            if (completed.changes !== 1) {
                throw new Error("delivery ownership changed under its write transaction");
            }
            this.injectFault("finalize:deliveryCompleted");

            this.db.exec("COMMIT");
            this.injectFault("finalize:committed");
            return { outcome: "completed" };
        } catch (error) {
            try {
                this.db.exec("ROLLBACK");
            } catch {
                // Preserve the operation's original failure.
            }
            throw error;
        }
    }

    /** Return only this token's in-flight work to the pending queue. */
    releaseDelivery(deliveryId: DeliveryGuid, claimToken: string): ReleaseDeliveryResult {
        assertDeliveryGuid(deliveryId);
        assertNonEmpty(claimToken, "claimToken");
        const result = this.db
            .prepare(
                `
                UPDATE seen_delivery
                SET state = 'pending', claim_worker = NULL,
                    claim_token = NULL, claimed_at = NULL
                WHERE delivery_id = ? AND state = 'processing' AND claim_token = ?
            `,
            )
            .run(deliveryId, claimToken);
        return result.changes === 1 ? { outcome: "released" } : { outcome: "notOwned" };
    }

    /**
     * Count one failed attempt, then either schedule the retry or dead-letter it — one
     * statement, so the count and the state it decides can never disagree. The cap is compared against the INCREMENTED count, and is a parameter: the store owns no policy.
     */
    releaseDeliveryAfterFailure(
        input: ReleaseDeliveryAfterFailureInput,
    ): ReleaseDeliveryAfterFailureResult {
        assertDeliveryGuid(input.deliveryId);
        assertNonEmpty(input.claimToken, "claimToken");
        assertUtcInstant(input.failedAt, "failedAt");
        assertUtcInstant(input.retryNotBefore, "retryNotBefore");
        assertAttemptCap(input.maxAttempts);

        const row = this.db
            .prepare(
                `
                UPDATE seen_delivery
                SET attempts = attempts + 1,
                    claim_worker = NULL,
                    claim_token = NULL,
                    claimed_at = NULL,
                    state = CASE WHEN attempts + 1 >= $cap THEN 'failed' ELSE 'pending' END,
                    completed_at = CASE WHEN attempts + 1 >= $cap THEN $failedAt ELSE NULL END,
                    retry_not_before =
                        CASE WHEN attempts + 1 >= $cap THEN NULL ELSE $retryNotBefore END
                WHERE delivery_id = $deliveryId
                  AND state = 'processing'
                  AND claim_token = $claimToken
                RETURNING state, attempts, retry_not_before
            `,
            )
            .get({
                $cap: input.maxAttempts,
                $failedAt: input.failedAt,
                $retryNotBefore: input.retryNotBefore,
                $deliveryId: input.deliveryId,
                $claimToken: input.claimToken,
            }) as FailedAttemptRow | undefined;

        if (row === undefined) return { outcome: "notOwned" };
        if (row.state === "failed") {
            return { outcome: "deadLettered", attempts: row.attempts };
        }
        return {
            outcome: "retryScheduled",
            attempts: row.attempts,
            retryNotBefore: input.retryNotBefore,
        };
    }

    /**
     * Every dead-lettered delivery, in stable dead-letter then GUID order.
     * Identity and attempt count only; the payload leaves the store through a claim.
     */
    deadLetteredDeliveries(): DeadLetteredDelivery[] {
        const rows = this.db
            .prepare(
                `
                SELECT delivery_id, event_name, payload_digest, received_at,
                       attempts, completed_at
                FROM seen_delivery
                WHERE state = 'failed'
                ORDER BY completed_at, delivery_id
            `,
            )
            .all() as unknown as DeadLetteredDeliveryRow[];
        return rows.map((row) => ({
            deliveryId: row.delivery_id as DeliveryGuid,
            eventName: row.event_name,
            payloadDigest: row.payload_digest,
            receivedAt: row.received_at,
            attempts: row.attempts,
            failedAt: row.completed_at,
        }));
    }

    redriveDelivery(deliveryId: DeliveryGuid): boolean {
        assertDeliveryGuid(deliveryId);
        return (
            this.db
                .prepare(
                    `
                    UPDATE seen_delivery
                    SET state = 'pending', claim_worker = NULL, claim_token = NULL,
                        claimed_at = NULL, completed_at = NULL, attempts = 0,
                        retry_not_before = NULL
                    WHERE delivery_id = ? AND state = 'failed'
                `,
                )
                .run(deliveryId).changes === 1
        );
    }

    /** Requeue stale processing rows without exposing their payloads. */
    requeueStuckDeliveries(claimedBefore: string): DeliveryGuid[] {
        assertUtcInstant(claimedBefore, "claimedBefore");
        const rows = this.db
            .prepare(
                `
                UPDATE seen_delivery
                SET state = 'pending', claim_worker = NULL,
                    claim_token = NULL, claimed_at = NULL
                WHERE state = 'processing' AND claimed_at <= ?
                RETURNING delivery_id
            `,
            )
            .all(claimedBefore) as { delivery_id: string }[];
        return (
            rows
                .map((row) => row.delivery_id as DeliveryGuid)
                // Default sort is UTF-16 code-unit order, which for these lowercase-hex
                // GUIDs IS SQLite's BINARY collation; a locale comparator can disagree.

                .sort()
        );
    }

    /** How many deliveries sit in each state, and the oldest done one still kept (D168). */
    counts(): DeliveryCounts {
        const row = this.db
            .prepare(
                `
                SELECT COUNT(CASE WHEN state = 'pending' THEN 1 END) AS pending,
                       COUNT(CASE WHEN state = 'processing' THEN 1 END) AS processing,
                       COUNT(CASE WHEN state = 'done' THEN 1 END) AS done,
                       COUNT(CASE WHEN state = 'failed' THEN 1 END) AS failed,
                       MIN(CASE WHEN state = 'done' THEN completed_at END) AS oldest_done
                FROM seen_delivery
            `,
            )
            .get() as unknown as DeliveryCountsRow;
        return {
            pending: row.pending,
            processing: row.processing,
            done: row.done,
            failed: row.failed,
            oldestDone: row.oldest_done,
        };
    }

    /** The newest delivery received, and when it finished (D168). */
    newestDelivery(): NewestDelivery | null {
        const row = this.db
            .prepare(
                `
                SELECT received_at, completed_at FROM seen_delivery
                ORDER BY received_at DESC, delivery_id DESC
                LIMIT 1
            `,
            )
            .get() as NewestDeliveryRow | undefined;
        return row === undefined
            ? null
            : { receivedAt: row.received_at, completedAt: row.completed_at };
    }

    /**
     * Delete only completed delivery identities past the retention boundary.
     * Pending and processing payloads are never eligible, regardless of age.
     */
    pruneCompletedDeliveries(before: string): number {
        assertUtcInstant(before, "before");
        return this.db
            .prepare(
                `
                DELETE FROM seen_delivery
                WHERE state = 'done' AND completed_at <= ?
            `,
            )
            .run(before).changes as number;
    }
}
