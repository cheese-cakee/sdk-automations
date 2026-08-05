/**
 * The shared middle of both entry points — NOT public API.
 *
 * `evaluateWrite` and `evaluateDestructive` answer different questions and
 * are not interchangeable (D52 makes the general path refuse a destructive
 * request outright), but they share a preflight and the general rules. Those
 * two functions live here so the pair are peers over a common middle, rather
 * than one reaching into the other.
 *
 * `safety/index.ts` deliberately does not re-export this file. An earlier
 * split exported both helpers to let `destructive.ts` reach them, and the
 * barrel's `export *` published the middle of a safety decision as package
 * API — something no consumer should ever call.
 */

import type { RepositoryConfig } from "../config/index.js";
import type {
    SafetyVerdict,
    WriteContext,
    WriteRequest,
} from "./types.js";

export function evaluatePreflight(
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

export function evaluateGeneralRulesAfterPreflight(
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
