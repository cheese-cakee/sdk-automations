/**
 * Exhaustive invariant sweeps — where the other suites check examples,
 * these enumerate the full input space and assert the PROPERTY:
 *  - `apply` happens exactly when every safety rule passes, swept over
 *    EVERY action class and capability-link state as well as every
 *    remaining context dimension (5,120 combos);
 *  - the projection is total and exclusive over all meaning subsets;
 *  - retryAdvice always terminates in bounded advice.
 */
import { describe, it, expect } from "vitest";
import {
    evaluateWrite,
    retryAdvice,
    MAX_RATE_LIMIT_ATTEMPTS,
    MAX_TOKEN_REFRESH_ATTEMPTS,
    projectIssueObservation,
    projectPrObservation,
    MAPPABLE_MEANINGS,
    ISSUE_MEANINGS,
    PR_MEANINGS,
    REPOSITORY_MODES,
    type ActionClass,
    type HumanChangeOrdering,
    type WriteContext,
    type MappableMeaning,
    type FailureClass,
} from "../src/index.js";

const CAUSE_AT = new Date("2026-07-01T00:00:00Z");
const CAPABILITY = "assignment";
const requestFor = (actionClass: ActionClass) => ({
    actionClass,
    capability: CAPABILITY,
    causeObservedAt: CAUSE_AT,
    cause: "sweep",
    target: { item: "issue #1", change: "label" },
});
const ACTION_CLASSES: ActionClass[] = [
    "observation",
    "humanFacingOutput",
    "reversibleStateChange",
    "clockTriggeredDestructive",
    "immediatePreventive",
];

describe("evaluateWrite: apply ⇔ every rule passes (full sweep)", () => {
    const bools = [false, true];
    const humanChanges: HumanChangeOrdering[] = [
        null,
        "unknown", // ordering could not be established — D51
        new Date("2026-06-30T00:00:00Z"), // older than the cause
        new Date("2026-07-02T00:00:00Z"), // newer than the cause
    ];

    /**
     * The action class is now a swept DIMENSION, not a fixed value.
     * D52 exists because it was fixed at `reversibleStateChange`: the
     * sweep was exhaustive in seven of eight input dimensions, and the
     * missing one was exactly where `clockTriggeredDestructive` slipped
     * through `evaluateWrite` and answered `apply`.
     */
    it("5,120 (class × context) combinations: apply exactly when nothing refuses and mode is active", () => {
        let applies = 0;
        let checked = 0;
        for (const actionClass of ACTION_CLASSES)
            for (const killSwitchActive of bools)
                for (const capabilityEnabled of bools)
                    for (const installationHasPermission of bools)
                        for (const itemBlocked of bools)
                            for (const preconditionHolds of bools)
                                for (const capabilityMatches of bools)
                                    for (const latestHumanChangeAt of humanChanges)
                                        for (const mode of REPOSITORY_MODES) {
                                        const context: WriteContext = {
                                            mode,
                                            capability: capabilityMatches ? CAPABILITY : "somethingElse",
                                            capabilityEnabled,
                                            installationHasPermission,
                                            killSwitchActive,
                                            itemBlocked,
                                            preconditionHolds,
                                            latestHumanChangeAt,
                                        };
                                        const verdict = evaluateWrite(requestFor(actionClass), context);
                                        checked += 1;
                                        // Every non-apply carries prose for humans.
                                        if (verdict.outcome !== "apply") {
                                            expect(verdict.reason.length).toBeGreaterThan(0);
                                        }
                                        if (verdict.outcome === "apply") applies += 1;

                                        const actionMayApply =
                                            actionClass !== "observation" &&
                                            actionClass !== "clockTriggeredDestructive";
                                        const humanOrderingAllowsWrite =
                                            latestHumanChangeAt === null ||
                                            (latestHumanChangeAt !== "unknown" &&
                                                latestHumanChangeAt.getTime() < CAUSE_AT.getTime());
                                        const everyRulePasses =
                                            actionMayApply &&
                                            !killSwitchActive &&
                                            capabilityMatches &&
                                            capabilityEnabled &&
                                            installationHasPermission &&
                                            !itemBlocked &&
                                            preconditionHolds &&
                                            humanOrderingAllowsWrite &&
                                            mode === "active";
                                        expect(verdict.outcome === "apply").toBe(everyRulePasses);

                                        // A destructive request can NEVER apply here,
                                        // whatever the context (D52).
                                        if (
                                            actionClass === "clockTriggeredDestructive" &&
                                            !killSwitchActive &&
                                            capabilityMatches
                                        ) {
                                            expect(verdict).toMatchObject({
                                                outcome: "refuse",
                                                code: "wrongEntryPoint",
                                            });
                                        }
                                        // Unestablished ordering can never apply (D51).
                                        if (
                                            latestHumanChangeAt === "unknown" &&
                                            actionClass !== "observation"
                                        ) {
                                            expect(verdict.outcome).not.toBe("apply");
                                        }
                                        }
        expect(checked).toBe(5_120); // 5 classes × 2^5 flags × 2 capability links × 4 orderings × 4 modes
        // 3 non-observation, non-destructive classes × active mode ×
        // {null, older} ordering = 6.
        expect(applies).toBe(6);
    });

    it("a mismatched capability refuses regardless of enablement (D53)", () => {
        for (const capabilityEnabled of [false, true]) {
            expect(
                evaluateWrite(requestFor("reversibleStateChange"), {
                    mode: "active",
                    capability: "somethingElse",
                    capabilityEnabled,
                    installationHasPermission: true,
                    killSwitchActive: false,
                    itemBlocked: false,
                    preconditionHolds: true,
                    latestHumanChangeAt: null,
                }),
            ).toMatchObject({ outcome: "refuse", code: "capabilityMismatch" });
        }
    });
});

describe("projection: total and exclusive over every meaning subset", () => {
    const subsets: MappableMeaning[][] = [];
    for (let mask = 0; mask < 1 << MAPPABLE_MEANINGS.length; mask++) {
        subsets.push(MAPPABLE_MEANINGS.filter((_, i) => mask & (1 << i)));
    }

    it.each([
        ["issue", projectIssueObservation, ISSUE_MEANINGS],
        ["pr", projectPrObservation, PR_MEANINGS],
    ] as const)("all 128 subsets project coherently for %s", (_name, project, own) => {
        const ownSet = new Set<MappableMeaning>(own);
        for (const meanings of subsets) {
            const ownPositions = meanings.filter((m) => ownSet.has(m));
            const projection = project({ closedBy: null, meanings });
            if (ownPositions.length > 1) {
                expect(projection.kind).toBe("conflict");
                if (projection.kind === "conflict") {
                    expect([...projection.positions].sort()).toEqual([...ownPositions].sort());
                }
            } else {
                expect(projection.kind).toBe("position");
                if (projection.kind === "position") {
                    expect(projection.state.meaning).toBe(ownPositions[0] ?? null);
                    expect(projection.state.blocked).toBe(meanings.includes("blocked"));
                    // Ignored is exactly the other flow's meanings.
                    for (const m of projection.ignored) {
                        expect(ownSet.has(m)).toBe(false);
                        expect(m).not.toBe("blocked");
                    }
                }
            }
        }
    });
});

describe("retryAdvice: bounded for every class and attempt", () => {
    const classes: FailureClass[] = [
        { kind: "tokenExpired" },
        { kind: "badCredentials" },
        { kind: "permissionMissing", acceptedPermissions: "" },
        { kind: "installationSuspended" },
        { kind: "forbiddenUnrecognized", bodySnippet: "" },
        {
            kind: "rateLimitResponseUnusable",
            headerName: "retry-after",
            headerValue: "",
            reason: "invalid",
        },
        { kind: "secondaryLimit" },
        { kind: "primaryExhausted", resetAt: "1000" },
        { kind: "primaryExhausted", resetAt: undefined },
        { kind: "notFoundOrNotInstalled" },
        { kind: "validationError" },
        { kind: "transient" },
    ];

    it("every class × attempts 0..5 yields valid advice, and waits always end", () => {
        for (const failure of classes) {
            for (let attempt = 0; attempt <= 5; attempt++) {
                const advice = retryAdvice(failure, attempt, 0);
                if (advice.action === "retryAfterMs") {
                    expect(advice.ms).toBeGreaterThanOrEqual(0);
                    expect(Number.isFinite(advice.ms)).toBe(true);
                }
            }
            // Past the bound, no advised-wait class waits forever.
            const late = retryAdvice(
                failure,
                Math.max(
                    MAX_RATE_LIMIT_ATTEMPTS,
                    MAX_TOKEN_REFRESH_ATTEMPTS,
                ) + 1,
                0,
            );
            if (
                failure.kind === "tokenExpired" ||
                failure.kind === "secondaryLimit" ||
                failure.kind === "primaryExhausted" ||
                failure.kind === "transient"
            ) {
                expect(late.action).toBe("doNotRetry");
            }
        }
    });
});
