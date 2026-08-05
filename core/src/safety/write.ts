/**
 * The public entry point for every action class EXCEPT
 * `clockTriggeredDestructive` — `design/core/safety.md` §2.
 */

import type { RepositoryConfig } from "../config/index.js";
import {
    evaluateGeneralRulesAfterPreflight,
    evaluatePreflight,
} from "./internal.js";
import type { SafetyVerdict, WriteContext, WriteRequest } from "./types.js";

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
