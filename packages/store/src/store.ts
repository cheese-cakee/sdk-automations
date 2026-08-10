/**
 * The owned operational store — `design/operations/storage-decision.md`
 * made real, with the exact crash semantics protocol 6.5 demonstrated.
 * **Ratification pending** under the stage-four review. schema.ts owns
 * recognition and migration; this file owns operational transitions.
 *
 * Design rules carried over from the evidence:
 *
 * - Delivery acceptance and report completion use explicit synchronous
 *   transactions, so returned outcomes describe committed rows.
 * - Tables have no foreign keys. Report completion deliberately changes
 *   the delivery and its report together under one write lock.
 * - The journal alone cannot disambiguate a sent-but-unconfirmed write
 *   (`sentUnknown`) — the caller must resolve it against GitHub state
 *   before retrying, per the recovery loop in the storage decision.
 */

import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { asDeliveryGuid, type DeliveryGuid } from "@hiero-hackers/automation-core";
import {
    assertSupportedStorageSchemaVersion,
    migrateStorageSchema,
    readStorageSchemaVersion,
    type MigrationFaultPoint,
} from "./schema.js";

/** One delivery's durable queue state. */
export type DeliveryState = "pending" | "processing" | "done";

/** Verified bytes and identity offered at the durable intake boundary. */
export interface AcceptDeliveryInput {
    readonly deliveryId: DeliveryGuid;
    readonly eventName: string;
    readonly payload: Uint8Array;
    readonly receivedAt: string;
}

/** The accepted, duplicate, or conflicting intake classification. */
export type AcceptDeliveryResult =
    | {
          readonly outcome: "accepted";
          readonly state: "pending";
          readonly payloadDigest: string;
      }
    | {
          readonly outcome: "duplicate";
          readonly state: DeliveryState;
          readonly payloadDigest: string;
      }
    | {
          readonly outcome: "conflict";
          readonly state: DeliveryState;
          readonly eventNameMismatch: boolean;
          readonly payloadMismatch: boolean;
      };

/** A delivery plus the token that currently owns its processing claim. */
export interface ClaimedDelivery {
    readonly deliveryId: DeliveryGuid;
    readonly eventName: string;
    readonly payload: Uint8Array;
    readonly payloadDigest: string;
    readonly receivedAt: string;
    readonly worker: string;
    readonly claimedAt: string;
    readonly claimToken: string;
}

/** Everything the store must bind to one report-and-completion commit. */
export interface CompleteDeliveryWithReportInput {
    readonly deliveryId: DeliveryGuid;
    readonly eventName: string;
    readonly payloadDigest: string;
    readonly claimToken: string;
    readonly reportJson: string;
    readonly completedAt: string;
}

/** The closed result of attempting the report-and-completion commit. */
export type CompleteDeliveryWithReportResult =
    | { readonly outcome: "completed" }
    | { readonly outcome: "alreadyCompleted" }
    | { readonly outcome: "notOwned" }
    | { readonly outcome: "identityMismatch" }
    | { readonly outcome: "reportConflict" };

/** One canonical report in deterministic projection-replay order. */
export interface CanonicalDeliveryReport {
    readonly deliveryId: DeliveryGuid;
    readonly reportJson: string;
    readonly completedAt: string;
}

/** A deliberate interruption point in schema or delivery durability work. */
export type StoreFaultPoint =
    | MigrationFaultPoint
    | "finalize:reportPersisted"
    | "finalize:deliveryCompleted"
    | "finalize:committed";

/** Optional dependencies for deterministic durability fault injection. */
export interface StoreOptions {
    readonly injectFault?: (point: StoreFaultPoint) => void;
}

/** Whether the supplied token released its delivery claim. */
export type ReleaseDeliveryResult =
    { readonly outcome: "released" } | { readonly outcome: "notOwned" };

/** The recovery classification derived from an effect's latest journal row. */
export type EffectState =
    | { readonly state: "neverStarted" }
    | {
          readonly state: "complete";
          readonly lastDoneSeq: number;
          readonly revision: string;
      }
    | {
          readonly state: "midSequence";
          readonly lastDoneSeq: number;
          readonly revision: string;
      }
    | {
          readonly state: "sentUnknown";
          readonly seq: number;
          readonly intent: string;
          /**
           * How many times this call has been sent — durable across
           * crashes, so a restarted process can hand `retryAdvice` a
           * truthful attempt number instead of restarting the bound
           * at zero.
           */
          readonly attempt: number;
          readonly revision: string;
      };

/** Clock-triggered work before or after ownership is attached. */
export interface ScheduleRow {
    readonly scheduleId: string;
    readonly dueAt: string;
    readonly effect: string;
}

export interface ClaimedScheduleRow extends ScheduleRow {
    /** Unique to this firing; required to complete it. */
    readonly claimToken: string;
}

/** One unresolved `sent` journal row — the sweep's unit of work. */
export interface OpenIntent {
    readonly effectId: string;
    readonly seq: number;
    readonly intent: string;
    readonly attempt: number;
    readonly at: string;
}

/**
 * The ONE timestamp format the store accepts: exactly the
 * `Date.toISOString()` shape — millisecond precision, `Z` suffix.
 * Constant width is what makes lexicographic order chronological
 * order, which every `<=` comparison in this file relies on. Mixed
 * precision breaks it (`"…00Z" > "…00.500Z"` as strings but earlier
 * in time — `'Z'` sorts above `'.'`), and an offset format sorts
 * wrongly outright — so both are thrown caller bugs, not data.
 * (Property-tested: order equivalence over random instant pairs.)
 */
/** Exported so the shell can validate before a store call. */
export function assertUtcInstant(value: string, param: string): void {
    const epochMs = Date.parse(value);
    if (
        value.length !== 24 ||
        !Number.isFinite(epochMs) ||
        new Date(epochMs).toISOString() !== value
    ) {
        throw new TypeError(
            `${param} must be a millisecond-precision UTC instant, exactly Date.toISOString() form (got ${JSON.stringify(value)})`,
        );
    }
}

function assertDeliveryGuid(value: DeliveryGuid): void {
    if (asDeliveryGuid(value) === undefined) {
        throw new TypeError("deliveryId must be a valid GitHub delivery GUID");
    }
}

function assertNonEmpty(value: string, param: string): void {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new TypeError(`${param} must be a non-empty string`);
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

function assertReportJson(value: string): void {
    let parsed: unknown = null;
    try {
        parsed = JSON.parse(value);
    } catch {}
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new TypeError("reportJson must be a JSON object");
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
}

interface DeliveryFinalizationRow {
    readonly event_name: string;
    readonly payload_digest: string;
    readonly state: DeliveryState;
    readonly claim_token: string | null;
}

interface StoredReportRow {
    readonly claim_token: string;
    readonly report_json: string;
}

interface CanonicalDeliveryReportRow {
    readonly delivery_id: string;
    readonly report_json: string;
    readonly completed_at: string;
}

/** The synchronous durable operational-state boundary. */
export class Store {
    private readonly db: DatabaseSync;
    private readonly injectFault: (point: StoreFaultPoint) => void;

    constructor(path: string, options: StoreOptions = {}) {
        this.db = new DatabaseSync(path);
        this.injectFault = options.injectFault ?? (() => {});
        try {
            const schemaVersion = readStorageSchemaVersion(this.db);
            assertSupportedStorageSchemaVersion(schemaVersion);
            // These two pragmas ARE the crash model — set explicitly,
            // not inherited as defaults. DELETE-mode journal +
            // synchronous FULL is what makes "everything before the
            // last returned call survives kill -9 and power loss" true.
            // The config test pins both so this cannot change silently.
            this.db.exec(`
                PRAGMA busy_timeout = 2000;
                PRAGMA journal_mode = DELETE;
                PRAGMA synchronous = FULL;
            `);
            migrateStorageSchema(this.db, this.injectFault);
        } catch (error) {
            try {
                this.db.close();
            } catch {
                // Preserve the initialization error.
            }
            throw error;
        }
    }

    // ── Durable webhook intake ─────────────────────────────────────

    /**
     * Atomically persist a verified delivery's identity and exact
     * bytes before an HTTP receiver acknowledges it. The transaction
     * keeps duplicate classification and the row it describes under
     * the same write lock, so a successful result always refers to a
     * durable row. Neither duplicates nor conflicts mutate the first
     * accepted delivery.
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
                        claimed_at, completed_at
                    ) VALUES (?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, NULL)
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
     * Claim one pending delivery, or atomically take over one stale
     * processing claim. Selection is stable by receipt time then GUID.
     * The generated 256-bit token, not the worker name, proves
     * ownership to completion and release calls.
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
                    claimed_at = ?
                WHERE delivery_id = (
                    SELECT delivery_id
                    FROM seen_delivery
                    WHERE state = 'pending'
                       OR (state = 'processing' AND claimed_at <= ?)
                    ORDER BY received_at, delivery_id
                    LIMIT 1
                )
                RETURNING delivery_id, event_name, payload, payload_digest,
                          received_at, claim_token
            `,
            )
            .get(worker, now, staleBefore) as ClaimedDeliveryRow | undefined;
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
        };
    }

    /** Persist one canonical report and complete only its current delivery claim. */
    completeDeliveryWithReport(
        input: CompleteDeliveryWithReportInput,
    ): CompleteDeliveryWithReportResult {
        assertDeliveryGuid(input.deliveryId);
        assertNonEmpty(input.eventName, "eventName");
        assertPayloadDigest(input.payloadDigest);
        assertNonEmpty(input.claimToken, "claimToken");
        assertReportJson(input.reportJson);
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

            if (
                delivery === undefined ||
                delivery.event_name !== input.eventName ||
                delivery.payload_digest !== input.payloadDigest
            ) {
                this.db.exec("ROLLBACK");
                return { outcome: "identityMismatch" };
            }

            const storedReport = this.db
                .prepare(
                    `
                SELECT claim_token, report_json
                FROM delivery_report
                WHERE delivery_id = ?
            `,
                )
                .get(input.deliveryId) as StoredReportRow | undefined;

            if (delivery.state === "done") {
                this.db.exec("ROLLBACK");
                if (storedReport === undefined || storedReport.claim_token !== input.claimToken) {
                    return { outcome: "notOwned" };
                }
                return storedReport.report_json === input.reportJson
                    ? { outcome: "alreadyCompleted" }
                    : { outcome: "reportConflict" };
            }

            if (delivery.claim_token !== input.claimToken) {
                this.db.exec("ROLLBACK");
                return { outcome: "notOwned" };
            }
            if (storedReport !== undefined) {
                this.db.exec("ROLLBACK");
                return { outcome: "reportConflict" };
            }

            this.db
                .prepare(
                    `
                INSERT INTO delivery_report (
                    delivery_id, claim_token, report_json, completed_at
                ) VALUES (?, ?, ?, ?)
            `,
                )
                .run(input.deliveryId, input.claimToken, input.reportJson, input.completedAt);
            this.injectFault("finalize:reportPersisted");

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

    /** Read the canonical source for a complete operator-projection rebuild. */
    deliveryReports(): CanonicalDeliveryReport[] {
        const rows = this.db
            .prepare(
                `
                SELECT delivery_id, report_json, completed_at
                FROM delivery_report
                ORDER BY completed_at, delivery_id
            `,
            )
            .all() as unknown as CanonicalDeliveryReportRow[];
        return rows.map((row) => ({
            deliveryId: row.delivery_id as DeliveryGuid,
            reportJson: row.report_json,
            completedAt: row.completed_at,
        }));
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
        return rows
            .map((row) => row.delivery_id as DeliveryGuid)
            .sort((left, right) => left.localeCompare(right));
    }

    // ── Effect journal (detector) ───────────────────────────────────

    /**
     * Record intent BEFORE the call — the row that survives any crash
     * after it. One upsert: a `done` row is immutable (acknowledged
     * history never regresses to `sent`), and re-declaring a still-open
     * call increments a durable `attempt` counter —
     * FINDING(store-journal-attempts), D42.
     */
    intent(
        effectId: string,
        seq: number,
        intent: string,
        at: string,
        /**
         * REQUIRED, with no default: the recovery loop compares this
         * against the current plan's revision, so a caller that omitted
         * it would journal a value matching no real plan and surface
         * every effect as unresolved. Fail-closed, but for a reason no
         * operator could act on.
         */
        revision: string,
    ): void {
        assertUtcInstant(at, "at");
        this.db
            .prepare(
                `
                INSERT INTO effect_journal VALUES (?, ?, ?, 'sent', ?, 1, ?)
                ON CONFLICT(effect_id, call_seq) DO UPDATE
                    SET attempt = attempt + 1,
                        at = excluded.at,
                        intent = excluded.intent,
                        revision = excluded.revision
                    WHERE effect_journal.status != 'done'
            `,
            )
            .run(effectId, seq, intent, at, revision);
    }

    /**
     * Mark a call done. Returns whether a row was actually marked —
     * `false` means no such intent row exists, which is a caller bug
     * worth noticing, not a state the store absorbs silently.
     */
    done(effectId: string, seq: number, at: string): boolean {
        assertUtcInstant(at, "at");
        const result = this.db
            .prepare(
                "UPDATE effect_journal SET status = 'done', at = ? WHERE effect_id = ? AND call_seq = ?",
            )
            .run(at, effectId, seq);
        return result.changes === 1;
    }

    /**
     * Classify an effect from the journal alone — the left half of the
     * storage decision's recovery loop. `planLength` is the declared
     * call count of the effect's plan (contract.md §5); the journal
     * cannot know completion without it.
     *
     * Classification reads the highest-seq row only, which assumes the
     * caller discipline the executor enforces: calls run sequentially,
     * and seq N+1 is never declared while seq N is still `sent`. The
     * store does not police that invariant.
     */
    effectState(effectId: string, planLength: number): EffectState {
        const rows = this.db
            .prepare(
                "SELECT call_seq, intent, status, attempt, revision FROM effect_journal WHERE effect_id = ? ORDER BY call_seq DESC LIMIT 1",
            )
            .all(effectId) as {
            call_seq: number;
            intent: string;
            status: string;
            attempt: number;
            revision: string;
        }[];
        const last = rows[0];
        if (last === undefined) return { state: "neverStarted" };
        if (last.status === "sent") {
            return {
                state: "sentUnknown",
                seq: last.call_seq,
                intent: last.intent,
                attempt: last.attempt,
                revision: last.revision,
            };
        }
        if (last.call_seq >= planLength) {
            return {
                state: "complete",
                lastDoneSeq: last.call_seq,
                revision: last.revision,
            };
        }
        return {
            state: "midSequence",
            lastDoneSeq: last.call_seq,
            revision: last.revision,
        };
    }

    /**
     * The sweep's worklist — every open `sent` row at or before
     * `before`, across all effects: the intents whose outcomes the
     * recovery loop must resolve against GitHub. Read-only;
     * resolution itself stays with `done`/`intent` and the resolver.
     */
    openIntents(before: string): OpenIntent[] {
        assertUtcInstant(before, "before");
        const rows = this.db
            .prepare(
                `
                SELECT effect_id, call_seq, intent, attempt, at FROM effect_journal
                WHERE status = 'sent' AND at <= ?
                ORDER BY at
            `,
            )
            .all(before) as {
            effect_id: string;
            call_seq: number;
            intent: string;
            attempt: number;
            at: string;
        }[];
        return rows.map((r) => ({
            effectId: r.effect_id,
            seq: r.call_seq,
            intent: r.intent,
            attempt: r.attempt,
            at: r.at,
        }));
    }

    // ── Claims (lock) ───────────────────────────────────────────────

    /**
     * One-winner LEASE on an effect — the 6.5 race serializer, with
     * atomic stale takeover so a crashed holder cannot deadlock the
     * effect. A fresh claim inserts; a claim with `at <= staleBefore`
     * is taken over in the same upsert (no delete-then-claim window).
     * Returns true iff the caller now holds it; non-contention
     * failures THROW — `false` strictly means "a live worker holds it".
     *
     * FINDING(store-claim-lease), D41: a lease can be stolen from a
     * live worker that outlives it — the journal plus GitHub re-read
     * stays the correctness layer. Lease duration is an ops decision.
     */
    claim(effectId: string, worker: string, now: string, staleBefore: string): boolean {
        assertUtcInstant(now, "now");
        assertUtcInstant(staleBefore, "staleBefore");
        const result = this.db
            .prepare(
                `
                INSERT INTO effect_claim VALUES (?, ?, ?)
                ON CONFLICT(effect_id) DO UPDATE SET worker = excluded.worker, at = excluded.at
                WHERE effect_claim.at <= ?
            `,
            )
            .run(effectId, worker, now, staleBefore);
        return result.changes === 1;
    }

    /**
     * Release a claim on clean completion — deletes only the caller's
     * OWN row, so releasing after your lease was stolen is a safe
     * no-op. Returns whether a row was actually released; `false`
     * means you no longer held it, which a caller may want to log.
     */
    release(effectId: string, worker: string): boolean {
        const result = this.db
            .prepare("DELETE FROM effect_claim WHERE effect_id = ? AND worker = ?")
            .run(effectId, worker);
        return result.changes === 1;
    }

    // ── Schedules ───────────────────────────────────────────────────

    /** Idempotent: re-declaring an existing schedule id is a no-op. */
    schedule(scheduleId: string, dueAt: string, effect: string): void {
        assertUtcInstant(dueAt, "dueAt");
        this.db
            .prepare("INSERT OR IGNORE INTO schedule VALUES (?, ?, ?, 'pending', NULL, NULL)")
            .run(scheduleId, dueAt, effect);
    }

    /**
     * Atomically claim every due pending schedule (pending → running,
     * stamped with `claimed_at = now`) and return the claimed rows.
     * Two instances calling concurrently split the due set; a restart
     * mid-processing does NOT re-fire a running schedule — redriving
     * stuck `running` rows is `requeueStuck`, driven by the
     * reconciliation sweep, deliberately not this method.
     */
    claimDue(now: string): ClaimedScheduleRow[] {
        assertUtcInstant(now, "now");
        const rows = this.db
            .prepare(
                `
                UPDATE schedule
                SET status = 'running',
                    claimed_at = ?,
                    claim_token = lower(hex(randomblob(16)))
                WHERE status = 'pending' AND due_at <= ?
                RETURNING schedule_id, due_at, effect, claim_token
            `,
            )
            .all(now, now) as {
            schedule_id: string;
            due_at: string;
            effect: string;
            claim_token: string;
        }[];
        return rows.map((r) => ({
            scheduleId: r.schedule_id,
            dueAt: r.due_at,
            effect: r.effect,
            claimToken: r.claim_token,
        }));
    }

    /**
     * The sweep's redrive — FINDING(store-sweep-api), D43: atomically
     * return stuck `running` schedules (claimed at or before
     * `claimedBefore`) to `pending`. Stuckness is claim age, never due
     * time, so backlog catch-up is not stolen from; requeued work
     * re-fires through `claimDue` — no parallel firing mechanism. A
     * slow-but-alive handler can be requeued and fire twice, harmless
     * on D41's grounds. The threshold is the sweep's ops decision.
     */
    requeueStuck(claimedBefore: string): ScheduleRow[] {
        assertUtcInstant(claimedBefore, "claimedBefore");
        const rows = this.db
            .prepare(
                `
                UPDATE schedule
                SET status = 'pending', claimed_at = NULL, claim_token = NULL
                WHERE status = 'running' AND claimed_at <= ?
                RETURNING schedule_id, due_at, effect
            `,
            )
            .all(claimedBefore) as {
            schedule_id: string;
            due_at: string;
            effect: string;
        }[];
        return rows.map((r) => ({
            scheduleId: r.schedule_id,
            dueAt: r.due_at,
            effect: r.effect,
        }));
    }

    scheduleDone(scheduleId: string, claimToken: string): boolean {
        const result = this.db
            .prepare(
                `
                UPDATE schedule
                SET status = 'done', claimed_at = NULL, claim_token = NULL
                WHERE schedule_id = ? AND status = 'running' AND claim_token = ?
            `,
            )
            .run(scheduleId, claimToken);
        return result.changes === 1;
    }

    // ── Retention (the sweep's pruning half — D43's adopted windows) ─

    /**
     * Delete only completed delivery identities whose completion time
     * reached the retention boundary. Pending and processing payloads
     * are never eligible, regardless of their age.
     */
    pruneCompletedDeliveries(before: string): number {
        assertUtcInstant(before, "before");
        this.db.exec("BEGIN IMMEDIATE");
        try {
            this.db
                .prepare(
                    `
                DELETE FROM delivery_report
                WHERE delivery_id IN (
                    SELECT delivery_id FROM seen_delivery
                    WHERE state = 'done' AND completed_at <= ?
                )
            `,
                )
                .run(before);
            const removed = this.db
                .prepare(
                    `
                DELETE FROM seen_delivery
                WHERE state = 'done' AND completed_at <= ?
            `,
                )
                .run(before).changes as number;
            this.db.exec("COMMIT");
            return removed;
        } catch (error) {
            try {
                this.db.exec("ROLLBACK");
            } catch {
                // Preserve the pruning failure.
            }
            throw error;
        }
    }

    /**
     * Delete DONE journal rows at or before `before`. Open (`sent`)
     * rows are never pruned — an unresolved effect stays visible until
     * the recovery loop or an operator closes it, however old.
     */
    pruneDoneJournal(before: string): number {
        assertUtcInstant(before, "before");
        return this.db
            .prepare("DELETE FROM effect_journal WHERE status = 'done' AND at <= ?")
            .run(before).changes as number;
    }

    close(): void {
        this.db.close();
    }
}
