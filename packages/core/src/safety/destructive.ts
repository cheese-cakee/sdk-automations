/**
 * Clock-triggered destructive actions — has the warning, the grace period and
 * the cancellation window been honoured (`design/guides/grace.md`)?
 */

import type { RepositoryConfig } from "../config/index.js";
import { evaluateGeneralRulesAfterPreflight, evaluatePreflight } from "./rules.js";
import type { ActionClass, SafetyVerdict, WriteContext, WriteRequest } from "./types.js";

const DESTRUCTIVE_WARNING_BRAND: unique symbol = Symbol("DestructiveWarning");

interface DestructiveRequestSnapshot {
    readonly actionClass: ActionClass;
    readonly capability: string;
    readonly causeObservedAtMs: number;
    readonly cause: string;
    readonly item: string;
    readonly change: string;
}

/** What a caller supplies to have a warning minted. */
export interface DestructiveWarningInput {
    readonly request: WriteRequest;
    readonly warnedAt: Date;
    readonly gracePeriodHours: number;
    readonly earliestActionAt: Date;
    readonly cancelledBy: string;
    readonly reversesWith: string;
}

/**
 * Authority for ONE request: the snapshot is what stops a warning being reused
 * across capabilities, items, changes or causal observations (D60).
 */
export interface DestructiveWarning {
    readonly [DESTRUCTIVE_WARNING_BRAND]: true;
    /** Copied primitives, never a reference to the caller's request. */
    readonly requestSnapshot: DestructiveRequestSnapshot;
    readonly warnedAtMs: number;
    readonly gracePeriodHours: number;
    /** Stated in the warning; may be later than the configured grace floor. */
    readonly earliestActionAtMs: number;
    readonly cancelledBy: string;
    readonly reversesWith: string;
}

/**
 * A warning AUTHORED but not yet posted: only the applier can supply the two
 * instants, from the moment GitHub says the comment landed (grace.md §3).
 */
export type PendingWarning = Omit<DestructiveWarningInput, "warnedAt" | "earliestActionAt">;

/**
 * Capture authority at warning time: numeric timestamps and copied strings,
 * never an alias to a mutable request target or `Date`.
 */
export function createDestructiveWarning(input: DestructiveWarningInput): DestructiveWarning {
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
        gracePeriodHours: input.gracePeriodHours,
        earliestActionAtMs: input.earliestActionAt.getTime(),
        cancelledBy: input.cancelledBy,
        reversesWith: input.reversesWith,
    });
}

/** A warning plus what has happened since — everything the gates need to judge. */
export interface DestructivePlan {
    readonly request: WriteRequest;
    readonly warning: DestructiveWarning | null;
    /** Qualifying activity from the affected person since the warning. */
    readonly qualifyingActivitySinceWarning: boolean;
}

/**
 * FINDING(safety-grace-floor): grace.md names no floor; the number is a
 * register decision (D154) and every plan is checked `>= MIN_GRACE_HOURS`.
 */
export const MIN_GRACE_HOURS = 1;

/**
 * The shortest a clock may run before the item it names is acted on
 * destructively; a destructive clock declares `atLeast: MIN_REAP_HOURS` (D154).
 */
export const MIN_REAP_HOURS = 2;

const HOUR_MS = 60 * 60 * 1000;

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

/** grace.md — every condition core can confirm before a future write. */
export function evaluateDestructive(
    plan: DestructivePlan,
    config: RepositoryConfig,
    context: WriteContext,
    now: Date,
): SafetyVerdict {
    // Kill switch first: the verdict CODE is contract, so the gate must be named (D39).
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
            reason: "no recorded warning — a destructive action never occurs on first observation (grace.md)",
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
        !Number.isFinite(plan.warning.gracePeriodHours) ||
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
    if (plan.warning.gracePeriodHours < MIN_GRACE_HOURS) {
        return {
            outcome: "refuse",
            code: "graceBelowFloor",
            reason: `grace period ${plan.warning.gracePeriodHours}h is below the ${MIN_GRACE_HOURS}h floor (grace.md)`,
        };
    }
    const minimumActionAt = plan.warning.warnedAtMs + plan.warning.gracePeriodHours * HOUR_MS;
    if (
        plan.warning.warnedAtMs < plan.warning.requestSnapshot.causeObservedAtMs ||
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
            reason: "the grace period has not fully elapsed (grace.md)",
        };
    }
    if (plan.qualifyingActivitySinceWarning) {
        return {
            outcome: "refuse",
            code: "activityCancelled",
            reason: "the affected person provided qualifying activity during the grace period (grace.md)",
        };
    }
    // The shared internal path, not `evaluateWrite`, which refuses this class (D52).
    return evaluateGeneralRulesAfterPreflight(plan.request, config, context);
}
