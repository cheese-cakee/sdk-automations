/**
 * The general rules every write passes, and the preflight before them.
 *
 * **If you are asking "why was my write refused?", this is the file.** Both
 * entry points — `write.ts` and `destructive.ts` — arrive here after applying
 * their own door policy.
 *
 * Only `GENERAL_RULES` is exported onward, because the ORDER is contract
 * (D39, D52); the rules themselves are not public API.
 *
 * `evaluateWrite` and `evaluateDestructive` answer different questions and are
 * not interchangeable — the general path REFUSES a destructive request outright
 * (`FINDING(safety-destructive-entry-point)`, D52) — but they share a preflight
 * and the general rules, so the pair are peers over a common middle rather than
 * one reaching into the other.
 */

import type { RepositoryConfig } from "../config/index.js";
import { missingPermissions } from "../github/index.js";
import { isBlocked } from "../workflow/index.js";
import type {
    RecordOnlyCode,
    SafetyRefusalCode,
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

/**
 * Everything a rule may look at, derived once so no rule recomputes it.
 */
interface Facts {
    readonly request: WriteRequest;
    readonly config: RepositoryConfig;
    readonly context: WriteContext;
    readonly capabilityEnabled: boolean;
    readonly missing: readonly string[];
}

type Rule = (f: Facts) => SafetyVerdict | null;

const refuse = (code: SafetyRefusalCode, reason: string): SafetyVerdict => ({
    outcome: "refuse",
    code,
    reason,
});
const record = (code: RecordOnlyCode, reason: string): SafetyVerdict => ({
    outcome: "record-only",
    code,
    reason,
});

/**
 * The general rules, IN ORDER — and the order is contract, not style.
 *
 * Expressed as data rather than a sequence of `if`s because precedence bugs
 * are a demonstrated class here: D52 was one. The kill switch was checked last
 * on the destructive path, so an operator who had pulled the emergency brake
 * was told "no recorded warning" instead. The outcome was a refusal either
 * way; the reported CODE contradicted the register, and D39 makes codes
 * contract.
 *
 * A sequence can only be tested by constructing inputs that trigger several
 * rules and observing which wins. A list can be asserted directly, which is
 * what `write.test.ts` now does.
 */
export const GENERAL_RULES: readonly (readonly [string, Rule])[] = [
    [
        // Observations need no permission and are always recordable.
        "observation",
        (f) =>
            f.request.actionClass === "observation"
                ? record("observation", "observation records a finding")
                : null,
    ],
    [
        "capabilityDisabled",
        (f) =>
            f.capabilityEnabled
                ? null
                : refuse(
                      "capabilityDisabled",
                      "the repository did not enable this capability (rule 1)",
                  ),
    ],
    [
        "permissionMissing",
        (f) =>
            f.missing.length === 0
                ? null
                : refuse(
                      "permissionMissing",
                      `the installation lacks ${f.missing.join(", ")} (rule 2)`,
                  ),
    ],
    [
        "itemBlocked",
        (f) =>
            isBlocked(f.context.world.observedMeanings)
                ? refuse(
                      "itemBlocked",
                      "the item is blocked — capability writes are paused (§5)",
                  )
                : null,
    ],
    [
        "preconditionStale",
        (f) =>
            f.context.world.preconditionHolds
                ? null
                : refuse(
                      "preconditionStale",
                      "the rechecked precondition no longer holds (rule 4)",
                  ),
    ],
    [
        // Unestablished ordering is a conflict, never an absence — checked
        // before the comparison, because there is nothing to compare against.
        "humanOrderingUnknown",
        (f) =>
            f.context.latestHumanChangeAt === "unknown"
                ? refuse(
                      "humanOrderingUnknown",
                      "ordering evidence for the newest human change is unavailable; the safe default is a conflict (manual-edits.md §2)",
                  )
                : null,
    ],
    [
        "invalidTimestamp",
        (f) =>
            !Number.isFinite(f.request.causeObservedAt.getTime()) ||
            (f.context.latestHumanChangeAt !== null &&
                f.context.latestHumanChangeAt !== "unknown" &&
                !Number.isFinite(f.context.latestHumanChangeAt.getTime()))
                ? refuse(
                      "invalidTimestamp",
                      "the write request contains an invalid observation or human-change timestamp",
                  )
                : null,
    ],
    [
        // Ties go to the human: GitHub timestamps have second granularity,
        // so exact ties happen (D33).
        "newerHumanChange",
        (f) =>
            f.context.latestHumanChangeAt !== null &&
            f.context.latestHumanChangeAt !== "unknown" &&
            f.context.latestHumanChangeAt.getTime() >=
                f.request.causeObservedAt.getTime()
                ? refuse(
                      "newerHumanChange",
                      "a human change at or after the cause conflicts; human edits are authoritative (rule 5)",
                  )
                : null,
    ],
    [
        "modeDisabled",
        (f) =>
            f.config.mode === "disabled"
                ? refuse("modeDisabled", "the repository mode is disabled")
                : null,
    ],
    [
        "modeRecordsOnly",
        (f) =>
            f.config.mode === "observe" || f.config.mode === "dry-run"
                ? record(
                      "modeRecordsOnly",
                      `repository mode is ${f.config.mode}; the effect is recorded, not applied (rule 10)`,
                  )
                : null,
    ],
];

export function evaluateGeneralRulesAfterPreflight(
    request: WriteRequest,
    config: RepositoryConfig,
    context: WriteContext,
): SafetyVerdict {
    const facts: Facts = {
        request,
        config,
        context,
        // Derived, never supplied: the reviewed file is the only source (D73).
        capabilityEnabled:
            config.capabilities[request.capability]?.enabled === true,
        missing: missingPermissions(
            request.requiredPermissions,
            context.installationGrants,
        ),
    };
    for (const [, rule] of GENERAL_RULES) {
        const verdict = rule(facts);
        if (verdict !== null) return verdict;
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
