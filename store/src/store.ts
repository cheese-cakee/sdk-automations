/**
 * The owned operational store — `design/operations/storage-decision.md`
 * made real, with the exact crash semantics protocol 6.5 demonstrated.
 * **Ratification pending** under the stage-four review; the schema is
 * the decided four independent tables and nothing else.
 *
 * Design rules carried over from the evidence:
 *
 * - Every write is one synchronous SQLite statement, so the on-disk
 *   state after `kill -9` is exactly "everything before the last call
 *   that returned" — the property the 6.5 harness relied on, and the
 *   property the crash tests here simulate by reopening the file in a
 *   fresh instance.
 * - The tables are independent: no foreign keys, no joins. Each hot
 *   path is a single INSERT or primary-key lookup.
 * - The journal alone cannot disambiguate a sent-but-unconfirmed write
 *   (`sentUnknown`) — the caller must resolve it against GitHub state
 *   before retrying, per the recovery loop in the storage decision.
 */

import { DatabaseSync } from "node:sqlite";
import type { DeliveryId } from "@hiero-hackers/automation-core";

export type EffectState =
    | { readonly state: "neverStarted" }
    | { readonly state: "complete" }
    | { readonly state: "midSequence"; readonly lastDoneSeq: number }
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
      };

export interface ScheduleRow {
    readonly scheduleId: string;
    readonly dueAt: string;
    readonly effect: string;
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
const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Exported so the shell can validate before a store call. */
export function assertUtcInstant(value: string, param: string): void {
    if (!UTC_INSTANT.test(value)) {
        throw new TypeError(
            `${param} must be a millisecond-precision UTC instant, exactly Date.toISOString() form (got ${JSON.stringify(value)})`,
        );
    }
}


export class Store {
    private readonly db: DatabaseSync;

    constructor(path: string) {
        this.db = new DatabaseSync(path);
        this.db.exec("PRAGMA busy_timeout = 2000");
        // These two pragmas ARE the crash model — set explicitly, not
        // inherited as defaults. DELETE-mode journal + synchronous FULL
        // is what makes "everything before the last returned call
        // survives kill -9 and power loss" true. WAL would trade that
        // durability for concurrency this one-process design does not
        // need; the config test pins both so the trade cannot happen
        // silently.
        this.db.exec("PRAGMA journal_mode = DELETE");
        this.db.exec("PRAGMA synchronous = FULL");
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS seen_delivery (
                delivery_id TEXT PRIMARY KEY,
                at          TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS effect_journal (
                effect_id TEXT NOT NULL,
                call_seq  INTEGER NOT NULL,
                intent    TEXT NOT NULL,
                status    TEXT NOT NULL CHECK (status IN ('sent', 'done')),
                at        TEXT NOT NULL,
                attempt   INTEGER NOT NULL,
                PRIMARY KEY (effect_id, call_seq)
            );
            CREATE TABLE IF NOT EXISTS effect_claim (
                effect_id TEXT PRIMARY KEY,
                worker    TEXT NOT NULL,
                at        TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS schedule (
                schedule_id TEXT PRIMARY KEY,
                due_at      TEXT NOT NULL,
                effect      TEXT NOT NULL,
                status      TEXT NOT NULL CHECK (status IN ('pending', 'running', 'done')),
                claimed_at  TEXT
            );
            -- The journal has no retention policy yet (D43), so the
            -- sweep's openIntents scan must not grow with all history
            -- ever: this partial index keeps it O(open intents). The
            -- schedule scans stay unindexed deliberately — that table
            -- is bounded by live schedules.
            CREATE INDEX IF NOT EXISTS open_intents
                ON effect_journal(at) WHERE status = 'sent';
        `);
    }

    // ── Delivery deduplication ──────────────────────────────────────

    /**
     * Record a delivery id; returns true iff never seen before. Keys
     * on the guid because redeliveries reuse it (6.2); branded string
     * because the raw ids exceed 2^53.
     */
    firstSeen(deliveryId: DeliveryId, at: string): boolean {
        assertUtcInstant(at, "at");
        const result = this.db
            .prepare("INSERT OR IGNORE INTO seen_delivery VALUES (?, ?)")
            .run(deliveryId, at);
        return result.changes === 1;
    }

    // ── Effect journal (detector) ───────────────────────────────────

    /**
     * Record intent BEFORE the call — the row that survives any crash
     * after it. One upsert: a `done` row is immutable (acknowledged
     * history never regresses to `sent`), and re-declaring a still-open
     * call increments a durable `attempt` counter —
     * FINDING(store-journal-attempts), D42. Pre-ratification store
     * files are not migrated.
     */
    intent(effectId: string, seq: number, intent: string, at: string): void {
        assertUtcInstant(at, "at");
        this.db
            .prepare(`
                INSERT INTO effect_journal VALUES (?, ?, ?, 'sent', ?, 1)
                ON CONFLICT(effect_id, call_seq) DO UPDATE
                    SET attempt = attempt + 1, at = excluded.at, intent = excluded.intent
                    WHERE effect_journal.status != 'done'
            `)
            .run(effectId, seq, intent, at);
    }

    /**
     * Mark a call done. Returns whether a row was actually marked —
     * `false` means no such intent row exists, which is a caller bug
     * worth noticing, not a state the store absorbs silently.
     */
    done(effectId: string, seq: number): boolean {
        const result = this.db
            .prepare("UPDATE effect_journal SET status = 'done' WHERE effect_id = ? AND call_seq = ?")
            .run(effectId, seq);
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
            .prepare("SELECT call_seq, intent, status, attempt FROM effect_journal WHERE effect_id = ? ORDER BY call_seq DESC LIMIT 1")
            .all(effectId) as { call_seq: number; intent: string; status: string; attempt: number }[];
        const last = rows[0];
        if (last === undefined) return { state: "neverStarted" };
        if (last.status === "sent") {
            return {
                state: "sentUnknown",
                seq: last.call_seq,
                intent: last.intent,
                attempt: last.attempt,
            };
        }
        if (last.call_seq >= planLength) return { state: "complete" };
        return { state: "midSequence", lastDoneSeq: last.call_seq };
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
            .prepare(`
                SELECT effect_id, call_seq, intent, attempt, at FROM effect_journal
                WHERE status = 'sent' AND at <= ?
                ORDER BY at
            `)
            .all(before) as { effect_id: string; call_seq: number; intent: string; attempt: number; at: string }[];
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
            .prepare(`
                INSERT INTO effect_claim VALUES (?, ?, ?)
                ON CONFLICT(effect_id) DO UPDATE SET worker = excluded.worker, at = excluded.at
                WHERE effect_claim.at <= ?
            `)
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
            .prepare("INSERT OR IGNORE INTO schedule VALUES (?, ?, ?, 'pending', NULL)")
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
    claimDue(now: string): ScheduleRow[] {
        assertUtcInstant(now, "now");
        const rows = this.db
            .prepare(`
                UPDATE schedule SET status = 'running', claimed_at = ?
                WHERE status = 'pending' AND due_at <= ?
                RETURNING schedule_id, due_at, effect
            `)
            .all(now, now) as { schedule_id: string; due_at: string; effect: string }[];
        return rows.map((r) => ({ scheduleId: r.schedule_id, dueAt: r.due_at, effect: r.effect }));
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
            .prepare(`
                UPDATE schedule SET status = 'pending', claimed_at = NULL
                WHERE status = 'running' AND claimed_at <= ?
                RETURNING schedule_id, due_at, effect
            `)
            .all(claimedBefore) as { schedule_id: string; due_at: string; effect: string }[];
        return rows.map((r) => ({ scheduleId: r.schedule_id, dueAt: r.due_at, effect: r.effect }));
    }

    scheduleDone(scheduleId: string): void {
        this.db
            .prepare("UPDATE schedule SET status = 'done' WHERE schedule_id = ?")
            .run(scheduleId);
    }

    // ── Retention (the sweep's pruning half — D43's adopted windows) ─

    /** Delete delivery-dedup rows recorded at or before `before`. Returns rows removed. */
    pruneSeen(before: string): number {
        assertUtcInstant(before, "before");
        return this.db
            .prepare("DELETE FROM seen_delivery WHERE at <= ?")
            .run(before).changes as number;
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
