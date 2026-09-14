/**
 * The general entry point — every action class EXCEPT
 * `clockTriggeredDestructive` (`design/contracts/safety.md`).
 */

import type { RepositoryConfig } from "../config/index.js";
import { evaluateGeneralRulesAfterPreflight, evaluatePreflight } from "./rules.js";
import type { SafetyVerdict, WriteContext, WriteRequest } from "./types.js";

/** May this write happen? The wrong gate is a verdict, not a bypass (D52). */
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
            reason: "a clock-triggered destructive action must be evaluated by evaluateDestructive, which alone enforces the warning and grace gates",
        };
    }
    if (request.actionClass === "immediatePreventive") {
        return {
            outcome: "refuse",
            code: "preventiveGateUnavailable",
            reason: "immediate preventive actions are disabled until the request proves an immediate explanation and a simple maintainer reversal (D54)",
        };
    }
    return evaluateGeneralRulesAfterPreflight(request, config, context);
}
