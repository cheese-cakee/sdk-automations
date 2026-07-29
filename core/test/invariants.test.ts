/**
 * Exhaustive invariant sweeps — where the other suites check examples,
 * these enumerate the full input space and assert the PROPERTY:
 *  - `apply` happens exactly when every safety rule passes (384 combos);
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
    type WriteContext,
    type MappableMeaning,
    type FailureClass,
} from "../src/index.js";

const CAUSE_AT = new Date("2026-07-01T00:00:00Z");
const request = {
    actionClass: "reversibleStateChange",
    capability: "assignment",
    causeObservedAt: CAUSE_AT,
    cause: "sweep",
    target: { item: "issue #1", change: "label" },
} as const;

describe("evaluateWrite: apply ⇔ every rule passes (full sweep)", () => {
    const bools = [false, true];
    const humanChanges: (Date | null)[] = [
        null,
        new Date("2026-06-30T00:00:00Z"), // older than the cause
        new Date("2026-07-02T00:00:00Z"), // newer than the cause
    ];

    it("384 contexts: the verdict is apply exactly when nothing refuses and mode is active", () => {
        let applies = 0;
        for (const killSwitchActive of bools)
            for (const capabilityEnabled of bools)
                for (const installationHasPermission of bools)
                    for (const itemBlocked of bools)
                        for (const preconditionHolds of bools)
                            for (const latestHumanChangeAt of humanChanges)
                                for (const mode of REPOSITORY_MODES) {
                                    const context: WriteContext = {
                                        mode,
                                        capabilityEnabled,
                                        installationHasPermission,
                                        killSwitchActive,
                                        itemBlocked,
                                        preconditionHolds,
                                        latestHumanChangeAt,
                                    };
                                    const verdict = evaluateWrite(request, context);
                                    // Every non-apply carries prose for humans.
                                    if (verdict.outcome !== "apply") {
                                        expect(verdict.reason.length).toBeGreaterThan(0);
                                    }
                                    const everyRulePasses =
                                        !killSwitchActive &&
                                        capabilityEnabled &&
                                        installationHasPermission &&
                                        !itemBlocked &&
                                        preconditionHolds &&
                                        (latestHumanChangeAt === null ||
                                            latestHumanChangeAt.getTime() < CAUSE_AT.getTime()) &&
                                        mode === "active";
                                    expect(verdict.outcome === "apply").toBe(everyRulePasses);
                                    if (verdict.outcome === "apply") applies++;
                                }
        expect(applies).toBe(2); // active mode × {null, older} human change
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
            const projection = project({ closed: false, meanings });
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
