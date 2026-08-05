/**
 * The vocabulary every safety decision is expressed in: what a capability
 * requests, what the shell rechecked, and the verdict shape both entry
 * points return.
 *
 * Types only, so `write.ts`, `destructive.ts` and `internal.ts` can all
 * depend on this without depending on each other.
 */

import type { RepositoryConfig } from "../config/index.js";
export type { RepositoryMode } from "../config/index.js";

export type ActionClass =
    | "observation"
    | "humanFacingOutput"
    | "reversibleStateChange"
    | "clockTriggeredDestructive"
    | "immediatePreventive";


/** What a capability must supply with every write request (safety.md §2.3). */
export interface WriteRequest {
    readonly actionClass: ActionClass;
    readonly capability: string;
    /** Dated cause — when the triggering observation was made. */
    readonly causeObservedAt: Date;
    readonly cause: string;
    /** The exact item and value the adapter may change (safety.md §2.6). */
    readonly target: { readonly item: string; readonly change: string };
}

/**
 * Ordering evidence for rule 5. A `Date` is the newest human change;
 * `null` means the shell CHECKED and found none; `"unknown"` means it
 * could not establish ordering at all.
 *
 * FINDING(safety-ordering-unknown), D51: the two cases used to collapse
 * into `null`, so unavailable evidence read as "no conflict" and the
 * write APPLIED. `manual-edits.md` §2 requires the opposite — "if
 * reliable ordering evidence is unavailable, the safe default is to
 * return a conflict and do nothing" — and D9 records that timestamp
 * reliability is still open, so unknown ordering is an expected state,
 * not a hypothetical.
 */
export type HumanChangeOrdering = Date | null | "unknown";

/** The facts the platform rechecked immediately before the write. */
/**
 * The facts a shell must RECHECK immediately before a write, and nothing
 * else. Mode, capability and enablement used to live here too, copied
 * alongside the configuration that already held them.
 *
 * FINDING(safety-context-derived), D73: three facts stored twice, free to
 * disagree, produced three separate repairs — D53 compared the capability
 * NAME, D67 compared the MODE, and the third, `capabilityEnabled`, was
 * never compared at all: a shell could assert consent for a capability the
 * reviewed configuration disabled, and D53's check passed because the names
 * matched. `evaluateWrite` now derives all three from the configuration and
 * the request, so a context that disagrees with the reviewed file cannot be
 * constructed rather than being caught. Two refusal codes disappear with
 * them; the fourth state stops being reachable.
 */
export interface WriteContext {
    readonly installationHasPermission: boolean;
    /** Kill switches: global / installation / repository / capability (safety.md §5). */
    readonly killSwitchActive: boolean;
    /** The item carries the mapped `blocked` meaning (safety.md §5). */
    readonly itemBlocked: boolean;
    /**
     * Shell attestation, not a fact the core can verify — the
     * precondition's shape is capability-specific. Executor tests own
     * this boundary; the workflow-state case is verified by
     * `applyTransition`'s stale-precondition guard.
     */
    readonly preconditionHolds: boolean;
    /**
     * When the newest HUMAN change on the touched state was made,
     * `null` if the shell checked and found none, `"unknown"` if it
     * could not establish ordering. The core compares this against
     * `causeObservedAt` (rule 5). The shell must exclude the causing
     * event itself when computing it — a human edit that triggers the
     * request is the cause, not a conflict.
     */
    readonly latestHumanChangeAt: HumanChangeOrdering;
}

/**
 * Machine-readable verdict causes — the executor, telemetry, the config
 * report, and managed explanations branch on `code`; `reason` is prose
 * for humans only. Same convention as `FailureClass` in failures.ts.
 */
export type SafetyRefusalCode =
    | "killSwitch"
    | "wrongEntryPoint"
    | "preventiveGateUnavailable"
    | "capabilityDisabled"
    | "permissionMissing"
    | "itemBlocked"
    | "preconditionStale"
    | "newerHumanChange"
    | "humanOrderingUnknown"
    | "invalidTimestamp"
    | "modeDisabled"
    | "wrongActionClass"
    | "noWarning"
    | "warningRequestMismatch"
    | "invalidDestructivePlan"
    | "graceBelowFloor"
    | "graceRunning"
    | "activityCancelled";

export type RecordOnlyCode = "observation" | "modeRecordsOnly";

export type SafetyVerdict =
    | { readonly outcome: "apply" }
    | {
          readonly outcome: "record-only";
          readonly code: RecordOnlyCode;
          readonly reason: string;
      }
    | {
          readonly outcome: "refuse";
          readonly code: SafetyRefusalCode;
          readonly reason: string;
      };

/**
 * safety.md §2 — the mechanically checkable subset of the ten rules.
 * Rules 7–10 (postcondition verification, unclear-outcome reconciliation,
 * tested rollback, dry-run-before-active rollout) are executor and process
 * obligations; they cannot be decided from a single request and live with
 * the effect executor when it exists.
 *
 * Check precedence is policy: kill switch → observation → consent
 * (rule 1) → authority (rule 2) → pause (§5) → staleness (rule 4) →
 * human conflict (rule 5) → mode. Only the kill-switch step changes an
 * outcome (FINDING below); otherwise order decides which `code` is
 * reported, frozen by the tests.
 */
