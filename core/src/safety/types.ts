/**
 * The vocabulary every safety decision is expressed in: what a capability
 * requests, what the shell rechecked, and the verdict shape both entry
 * points return.
 *
 * Types only, so `write.ts`, `destructive.ts` and `internal.ts` can all
 * depend on this without depending on each other.
 */

import type { MappableMeaning, RepositoryConfig } from "../config/index.js";
import type { PermissionGrant } from "../github/index.js";
export type { RepositoryMode } from "../config/index.js";

export type ActionClass =
    | "observation"
    | "humanFacingOutput"
    | "reversibleStateChange"
    | "clockTriggeredDestructive"
    | "immediatePreventive";


/** What a capability must supply with every write request (safety.md §2.3). */
export interface WriteRequest {
    /**
     * What this write needs, from the operation catalogue. Supplied rather
     * than derived because core must not depend on the capability layer.
     */
    readonly requiredPermissions: readonly PermissionGrant[];
    readonly actionClass: ActionClass;
    readonly capability: string;
    /** Dated cause — when the triggering observation was made. */
    readonly causeObservedAt: Date;
    readonly cause: string;
    /** The exact item and value the adapter may change (safety.md §2.6). */
    readonly target: { readonly item: string; readonly change: string };
}

    /**
     * When the newest HUMAN change was made: a `Date`, `null` if the shell
     * checked and found none, or `"unknown"` if it could not establish
     * ordering. Unestablished ordering is a conflict, never an absence
     * (`FINDING(safety-ordering-unknown)`, D51).
     */
export type HumanChangeOrdering = Date | null | "unknown";

/** The facts the platform rechecked immediately before the write. */
/**
 * The facts a shell must RECHECK immediately before a write, and nothing else.
 *
 * Mode, capability, enablement and blocked-ness used to live here too, copied
 * alongside sources that already held them. All four are now derived
 * (`FINDING(safety-context-derived)`, D73, D77).
 */
export interface WriteContext {
    /**
     * What GitHub GRANTED this installation — not whether it is enough.
     * The engine computes sufficiency from the request's requirements, so a
     * refusal can name the missing permission instead of saying only that
     * one was missing (D77).
     */
    readonly installationGrants: readonly PermissionGrant[];
    /** Kill switches: global / installation / repository / capability (safety.md §5). */
    readonly killSwitchActive: boolean;
    /**
     * The mapped meanings the shell OBSERVED on the item. Whether that means
     * the item is paused is `isBlocked`'s decision, made once in
     * `workflow/meanings.ts` — the projection already computed it from the
     * same input, and a separate boolean here was free to disagree (D77).
     */
    readonly observedMeanings: readonly MappableMeaning[];
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
