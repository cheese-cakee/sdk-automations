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

/**
 * safety.md §1 — action classes, ordered by increasing risk.
 *
 * `clockTriggeredDestructive` is the only class this module refuses to
 * judge from `evaluateWrite` alone; it has its own entry point, because
 * §3's warning and grace gates cannot be decided from a single request.
 *
 * `immediatePreventive` (safety.md §1's issue-lock row) remains a real
 * design class, but fails closed until its request can prove the
 * immediate explanation and simple maintainer reversal §1 requires.
 */
import type { RepositoryConfig } from "./config.js";

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
function evaluatePreflight(
    context: WriteContext,
): SafetyVerdict | null {
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
    return null;
}

function evaluateGeneralRulesAfterPreflight(
    request: WriteRequest,
    config: RepositoryConfig,
    context: WriteContext,
): SafetyVerdict {
    // Derived, never supplied: the reviewed file is the only source.
    const capabilityEnabled =
        config.capabilities[request.capability]?.enabled === true;
    if (request.actionClass === "observation") {
        // Observations need no write permission and are always recordable.
        return {
            outcome: "record-only",
            code: "observation",
            reason: "observation records a finding",
        };
    }
    if (!capabilityEnabled) {
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
     * FINDING(safety-ordering-unknown), D51: unestablished ordering is a
     * conflict, never an absence — `manual-edits.md` §2's safe default.
     * Checked before the comparison below, because there is nothing to
     * compare against.
     */
    if (context.latestHumanChangeAt === "unknown") {
        return {
            outcome: "refuse",
            code: "humanOrderingUnknown",
            reason: "ordering evidence for the newest human change is unavailable; the safe default is a conflict (manual-edits.md §2)",
        };
    }
    if (
        !Number.isFinite(request.causeObservedAt.getTime()) ||
        (context.latestHumanChangeAt !== null &&
            !Number.isFinite(context.latestHumanChangeAt.getTime()))
    ) {
        return {
            outcome: "refuse",
            code: "invalidTimestamp",
            reason: "the write request contains an invalid observation or human-change timestamp",
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
    if (config.mode === "disabled") {
        return {
            outcome: "refuse",
            code: "modeDisabled",
            reason: "the repository mode is disabled",
        };
    }
    if (config.mode === "observe" || config.mode === "dry-run") {
        return {
            outcome: "record-only",
            code: "modeRecordsOnly",
            reason: `repository mode is ${config.mode}; the effect is recorded, not applied (rule 10)`,
        };
    }
    return { outcome: "apply" };
}

/**
 * The public entry point for every action class EXCEPT
 * `clockTriggeredDestructive`.
 *
 * FINDING(safety-destructive-entry-point), D52: this used to accept a
 * destructive request and answer `apply`, so §3's warning and grace
 * gates were enforced only by the caller happening to choose
 * `evaluateDestructive`. The module's headline claim — a destructive
 * action cannot fire without a recorded warning and an elapsed grace
 * period — was therefore a calling convention, not a property. Refusing
 * here makes the wrong entry point a verdict rather than a bypass, in
 * the same spirit as `ids.ts` making a numeric delivery id a compile
 * error.
 */
export function evaluateWrite(
    request: WriteRequest,
    config: RepositoryConfig,
    context: WriteContext,
): SafetyVerdict {
    const preflight = evaluatePreflight(context);
    if (preflight !== null) return preflight;
    if (request.actionClass === "clockTriggeredDestructive") {
        return {
            outcome: "refuse",
            code: "wrongEntryPoint",
            reason: "a clock-triggered destructive action must be evaluated by evaluateDestructive, which alone enforces the §3 warning and grace gates",
        };
    }
    if (request.actionClass === "immediatePreventive") {
        return {
            outcome: "refuse",
            code: "preventiveGateUnavailable",
            reason: "immediate preventive actions are disabled until the request proves an immediate explanation and a simple maintainer reversal (safety.md §1)",
        };
    }
    return evaluateGeneralRulesAfterPreflight(request, config, context);
}

// ─── Clock-triggered destructive actions (safety.md §3) ──────────────

/**
 * A recorded warning, the precondition of every destructive action:
 * "a clock-triggered action never occurs on its first stale observation."
 */
const DESTRUCTIVE_WARNING_BRAND: unique symbol = Symbol("DestructiveWarning");

interface DestructiveRequestSnapshot {
    readonly actionClass: ActionClass;
    readonly capability: string;
    readonly causeObservedAtMs: number;
    readonly cause: string;
    readonly item: string;
    readonly change: string;
}

export interface DestructiveWarningInput {
    readonly request: WriteRequest;
    readonly warnedAt: Date;
    readonly gracePeriodDays: number;
    readonly earliestActionAt: Date;
    readonly cancelledBy: string;
    readonly reversesWith: string;
}

export interface DestructiveWarning {
    /**
     * FINDING(safety-warning-binding), D60: a warning is authority for
     * one request, not a reusable timestamp. The immutable request
     * snapshot prevents warning reuse across capabilities, items,
     * changes, or causal observations.
     */
    /** Only `createDestructiveWarning` can construct a typed warning. */
    readonly [DESTRUCTIVE_WARNING_BRAND]: true;
    /** Copied primitives, never a reference to the caller's request. */
    readonly requestSnapshot: DestructiveRequestSnapshot;
    readonly warnedAtMs: number;
    readonly gracePeriodDays: number;
    /** Stated in the warning; may be later than the configured grace floor. */
    readonly earliestActionAtMs: number;
    /** What cancels the plan, stated in the warning (safety.md §3). */
    readonly cancelledBy: string;
    /** How a maintainer reverses the action after it occurs. */
    readonly reversesWith: string;
}

/**
 * Capture authority at warning time. Numeric timestamps and copied strings
 * avoid aliases to mutable request targets and mutable Date internal state.
 */
export function createDestructiveWarning(
    input: DestructiveWarningInput,
): DestructiveWarning {
    const requestSnapshot: DestructiveRequestSnapshot = Object.freeze({
        actionClass: input.request.actionClass,
        capability: input.request.capability,
        causeObservedAtMs: input.request.causeObservedAt.getTime(),
        cause: input.request.cause,
        item: input.request.target.item,
        change: input.request.target.change,
    });
    return Object.freeze({
        [DESTRUCTIVE_WARNING_BRAND]: true as const,
        requestSnapshot,
        warnedAtMs: input.warnedAt.getTime(),
        gracePeriodDays: input.gracePeriodDays,
        earliestActionAtMs: input.earliestActionAt.getTime(),
        cancelledBy: input.cancelledBy,
        reversesWith: input.reversesWith,
    });
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

function warningMatchesRequest(
    warned: DestructiveRequestSnapshot,
    requested: WriteRequest,
): boolean {
    return (
        warned.actionClass === requested.actionClass &&
        warned.capability === requested.capability &&
        warned.causeObservedAtMs === requested.causeObservedAt.getTime() &&
        warned.cause === requested.cause &&
        warned.item === requested.target.item &&
        warned.change === requested.target.change
    );
}

/** safety.md §3 — every condition the executor confirms before acting. */
export function evaluateDestructive(
    plan: DestructivePlan,
    config: RepositoryConfig,
    context: WriteContext,
    now: Date,
): SafetyVerdict {
    /**
     * FINDING(safety-killswitch-order), D52: the kill switch used to be
     * reached only via the general rules at the very END of this
     * function, so an operator who had pulled the emergency brake was
     * told "no recorded warning" instead. The outcome was always a
     * refusal, but D39 freezes the verdict CODES as contract and claims
     * kill-switch-first, so the reported code contradicted the register.
     */
    const preflight = evaluatePreflight(context);
    if (preflight !== null) return preflight;
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
    if (!warningMatchesRequest(plan.warning.requestSnapshot, plan.request)) {
        return {
            outcome: "refuse",
            code: "warningRequestMismatch",
            reason: "the recorded warning does not authorize this exact capability, target, change, and causal observation",
        };
    }
    if (
        !Number.isFinite(plan.warning.gracePeriodDays) ||
        !Number.isFinite(plan.warning.warnedAtMs) ||
        !Number.isFinite(plan.warning.earliestActionAtMs) ||
        !Number.isFinite(plan.warning.requestSnapshot.causeObservedAtMs) ||
        plan.warning.cancelledBy.trim() === "" ||
        plan.warning.reversesWith.trim() === "" ||
        !Number.isFinite(now.getTime())
    ) {
        return {
            outcome: "refuse",
            code: "invalidDestructivePlan",
            reason: "the destructive plan contains a non-finite grace period or invalid timestamp",
        };
    }
    if (plan.warning.gracePeriodDays < MIN_GRACE_DAYS) {
        return {
            outcome: "refuse",
            code: "graceBelowFloor",
            reason: `grace period ${plan.warning.gracePeriodDays}d is below the ${MIN_GRACE_DAYS}d floor (§4)`,
        };
    }
    const minimumActionAt =
        plan.warning.warnedAtMs + plan.warning.gracePeriodDays * DAY_MS;
    if (
        plan.warning.warnedAtMs <
            plan.warning.requestSnapshot.causeObservedAtMs ||
        plan.warning.earliestActionAtMs < minimumActionAt
    ) {
        return {
            outcome: "refuse",
            code: "invalidDestructivePlan",
            reason: "the warning predates its observation or states an action time before the full grace period",
        };
    }
    if (now.getTime() < plan.warning.earliestActionAtMs) {
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
    // All destructive-specific gates passed; the general write rules
    // decide. Calls the shared internal path, not the public
    // `evaluateWrite`, which now refuses this action class outright (D52).
    return evaluateGeneralRulesAfterPreflight(plan.request, config, context);
}
