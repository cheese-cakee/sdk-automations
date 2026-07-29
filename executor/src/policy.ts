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

/**
 * D43 — working retention for `seen_delivery` and done journal rows.
 * Open (`sent`) journal rows are NEVER pruned — an unresolved effect
 * stays visible until the recovery loop or an operator closes it.
 */
export const RETENTION_DAYS = 90;

/**
 * D46 — the freshness rule, from the 6.7 measurement
 * (`design/operations/read-after-write.md`): 40/40 trials visible on
 * the first immediate read, so "present" may be answered on first
 * sight — but "absent" re-sends a possibly non-idempotent call, so the
 * port answers "absent" only after this many reads, spaced by this
 * delay (~2× the observed p95). Insurance on the asymmetric side,
 * priced at one API call on the rare recovery path.
 */
export const READBACK_ABSENT_READS = 2;
export const READBACK_CONFIRM_ABSENT_DELAY_MS = 1_000;
