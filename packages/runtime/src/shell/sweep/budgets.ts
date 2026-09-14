/** What one firing of the sweep may spend, and how long until the next one. */

/** How often a repository is read when nothing says otherwise; the smallest reap a `duration` may state is two hours. */
export const DEFAULT_SWEEP_CADENCE_MS = 60 * 60_000;

/** How many writes one firing may send before it carries the rest to the next (D167). */
export const SWEEP_WRITE_CALLS = 20;

/** How many requests one firing may spend reading, of GitHub's hourly five thousand (D170). */
export const SWEEP_READ_REQUESTS = 2_000;
