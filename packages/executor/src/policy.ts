/**
 * The adopted operational values — the 2026-07-25 adoption record in
 * `design/decisions.md` §3, encoded so the working numbers have one
 * greppable home and cannot drift from the register silently. Stage
 * four may revise them; revising means editing HERE plus the record.
 */

/** D41 — the claim lease. Must exceed the longest plausible effect. */
export const LEASE_MS = 15 * 60_000;

/**
 * D43 — a `running` schedule claimed longer ago than this is stuck and
 * may be requeued by the sweep. Twice the lease, so a live-but-slow
 * holder always loses its claim lease before its schedule is requeued.
 */
export const REQUEUE_STALE_MS = 2 * LEASE_MS;

/** D43 — working retention for `seen_delivery` and done journal rows. */
export const RETENTION_DAYS = 90;

/**
 * D46 — the freshness rule the read-back port owes. The two constants
 * below are asymmetric on purpose: a wrong "present" costs nothing, but
 * a wrong "absent" re-sends a possibly non-idempotent call. So "present"
 * may be answered on first sight, and "absent" only after repeated
 * reads. The delay is ~2× the p95 measured by protocol 6.7
 * (`design/operations/read-after-write.md`).
 */

/** How many reads must agree before the port may answer "absent". */
export const READBACK_ABSENT_READS = 2;

/** The spacing between those reads. */
export const READBACK_CONFIRM_ABSENT_DELAY_MS = 1_000;
