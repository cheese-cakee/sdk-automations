/**
 * The safety engine as pure logic — `design/core/safety.md` §1–§3 and §5.
 *
 * This module evaluates whether a requested write is permitted; it performs
 * no I/O. The caller (eventually the effect executor) supplies the facts —
 * current mode, permissions, rechecked state, clock — and receives a
 * verdict. Keeping the rules pure means every one of safety.md's "rules for
 * every write" that is mechanically checkable is checkable here, in
 * milliseconds, without a GitHub App existing yet.
 */

/** safety.md §1 — action classes, ordered by increasing risk. */
export type ActionClass =
    | "observation"
    | "humanFacingOutput"
    | "reversibleStateChange"
    | "clockTriggeredDestructive"
    | "immediatePreventive";

/** design/config/schema.md §4 — repository modes. */
export type RepositoryMode = "disabled" | "observe" | "dry-run" | "active";

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

/** The facts the platform rechecked immediately before the write. */
export interface WriteContext {
    readonly mode: RepositoryMode;
    readonly capabilityEnabled: boolean;
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
     * `null` if none. The core compares this against `causeObservedAt`
     * (rule 5). The shell must exclude the causing event itself when
     * computing it — a human edit that triggers the request is the
     * cause, not a conflict.
     */
    readonly latestHumanChangeAt: Date | null;
}

/**
 * Machine-readable verdict causes — the executor, telemetry, the config
 * report, and managed explanations branch on `code`; `reason` is prose
 * for humans only. Same convention as `FailureClass` in failures.ts.
 */
export type SafetyRefusalCode =
    | "killSwitch"
    | "capabilityDisabled"
    | "permissionMissing"
    | "itemBlocked"
    | "preconditionStale"
    | "newerHumanChange"
    | "modeDisabled"
    | "wrongActionClass"
    | "noWarning"
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
export function evaluateWrite(
    request: WriteRequest,
    context: WriteContext,
): SafetyVerdict {
    /**
     * FINDING(safety-killswitch-observations), D39: checked before the
     * observation short-circuit — an active kill switch refuses even
     * pure observations. "Stop" stops reading-and-recording too.
     */
    if (context.killSwitchActive) {
        return {
            outcome: "refuse",
            code: "killSwitch",
            reason: "a kill switch is active",
        };
    }
    if (request.actionClass === "observation") {
        // Observations need no write permission and are always recordable.
        return {
            outcome: "record-only",
            code: "observation",
            reason: "observation records a finding",
        };
    }
    if (!context.capabilityEnabled) {
        return {
            outcome: "refuse",
            code: "capabilityDisabled",
            reason: "the repository did not enable this capability (rule 1)",
        };
    }
    if (!context.installationHasPermission) {
        return {
            outcome: "refuse",
            code: "permissionMissing",
            reason: "the installation lacks the required permission (rule 2)",
        };
    }
    if (context.itemBlocked) {
        return {
            outcome: "refuse",
            code: "itemBlocked",
            reason: "the item is blocked — capability writes are paused (§5)",
        };
    }
    if (!context.preconditionHolds) {
        return {
            outcome: "refuse",
            code: "preconditionStale",
            reason: "the rechecked precondition no longer holds (rule 4)",
        };
    }
    /**
     * FINDING(safety-human-tie), D33: ties go to the human (`>=`) —
     * GitHub timestamps have second granularity, so exact ties happen.
     */
    if (
        context.latestHumanChangeAt !== null &&
        context.latestHumanChangeAt.getTime() >= request.causeObservedAt.getTime()
    ) {
        return {
            outcome: "refuse",
            code: "newerHumanChange",
            reason: "a human change at or after the cause conflicts; human edits are authoritative (rule 5)",
        };
    }
    if (context.mode === "disabled") {
        return {
            outcome: "refuse",
            code: "modeDisabled",
            reason: "the repository mode is disabled",
        };
    }
    if (context.mode === "observe" || context.mode === "dry-run") {
        return {
            outcome: "record-only",
            code: "modeRecordsOnly",
            reason: `repository mode is ${context.mode}; the effect is recorded, not applied (rule 10)`,
        };
    }
    return { outcome: "apply" };
}

// ─── Clock-triggered destructive actions (safety.md §3) ──────────────

/**
 * A recorded warning, the precondition of every destructive action:
 * "a clock-triggered action never occurs on its first stale observation."
 */
export interface DestructiveWarning {
    readonly warnedAt: Date;
    readonly gracePeriodDays: number;
    /** What cancels the plan, stated in the warning (safety.md §3). */
    readonly cancelledBy: string;
}

export interface DestructivePlan {
    readonly request: WriteRequest;
    readonly warning: DestructiveWarning | null;
    /** Qualifying activity from the affected person since the warning. */
    readonly qualifyingActivitySinceWarning: boolean;
}

/**
 * FINDING(safety-grace-floor): safety.md §4 requires the schema to "set safe
 * minimums and prevent a zero-day or negative grace period" but names no
 * floor. This module enforces `>= MIN_GRACE_DAYS`; the exact number is a
 * register decision — 1 is the weakest defensible reading, encoded here so
 * the question cannot be silently skipped.
 */
export const MIN_GRACE_DAYS = 1;

const DAY_MS = 24 * 60 * 60 * 1000;

/** safety.md §3 — every condition the executor confirms before acting. */
export function evaluateDestructive(
    plan: DestructivePlan,
    context: WriteContext,
    now: Date,
): SafetyVerdict {
    if (plan.request.actionClass !== "clockTriggeredDestructive") {
        return {
            outcome: "refuse",
            code: "wrongActionClass",
            reason: "evaluateDestructive only accepts clock-triggered destructive requests",
        };
    }
    if (plan.warning === null) {
        return {
            outcome: "refuse",
            code: "noWarning",
            reason: "no recorded warning — a destructive action never occurs on first observation (§3)",
        };
    }
    if (plan.warning.gracePeriodDays < MIN_GRACE_DAYS) {
        return {
            outcome: "refuse",
            code: "graceBelowFloor",
            reason: `grace period ${plan.warning.gracePeriodDays}d is below the ${MIN_GRACE_DAYS}d floor (§4)`,
        };
    }
    const elapsedMs = now.getTime() - plan.warning.warnedAt.getTime();
    if (elapsedMs < plan.warning.gracePeriodDays * DAY_MS) {
        return {
            outcome: "refuse",
            code: "graceRunning",
            reason: "the grace period has not fully elapsed (§3)",
        };
    }
    if (plan.qualifyingActivitySinceWarning) {
        return {
            outcome: "refuse",
            code: "activityCancelled",
            reason: "the affected person provided qualifying activity during the grace period (§3)",
        };
    }
    // All destructive-specific gates passed; the general write rules decide.
    return evaluateWrite(plan.request, context);
}
