import { describe, it, expect } from "vitest";
import {
    evaluateWrite,
    evaluateDestructive,
    MIN_GRACE_DAYS,
    type WriteRequest,
    type WriteContext,
    type DestructivePlan,
    type DestructiveWarning,
} from "../src/safety.js";
import { REPOSITORY_MODES } from "../src/config.js";

const request = (over?: Partial<WriteRequest>): WriteRequest => ({
    actionClass: "reversibleStateChange",
    capability: "assignment",
    causeObservedAt: new Date("2026-07-01T00:00:00Z"),
    cause: "contributor requested /assign",
    target: { item: "issue #42", change: "add label 'status: in progress'" },
    ...over,
});

const context = (over?: Partial<WriteContext>): WriteContext => ({
    mode: "active",
    capability: "assignment", // must match request().capability — D53
    capabilityEnabled: true,
    installationHasPermission: true,
    killSwitchActive: false,
    itemBlocked: false,
    preconditionHolds: true,
    latestHumanChangeAt: null,
    ...over,
});

const warningFor = (
    warnedRequest: WriteRequest,
    over?: Partial<DestructiveWarning>,
): DestructiveWarning => ({
    request: warnedRequest,
    warnedAt: new Date("2026-07-01T00:00:00Z"),
    gracePeriodDays: 7,
    earliestActionAt: new Date("2026-07-08T00:00:00Z"),
    cancelledBy: "any comment or commit by the assignee",
    reversesWith: "a maintainer or author restores the previous state",
    ...over,
});

describe("evaluateWrite (safety.md §2)", () => {
    it("applies only when every rule passes in active mode", () => {
        expect(evaluateWrite(request(), context())).toEqual({ outcome: "apply" });
    });

    it.each([
        ["kill switch", { killSwitchActive: true }, "killSwitch"],
        ["capability disabled (rule 1)", { capabilityEnabled: false }, "capabilityDisabled"],
        ["missing permission (rule 2)", { installationHasPermission: false }, "permissionMissing"],
        ["blocked item (§5)", { itemBlocked: true }, "itemBlocked"],
        ["failed precondition recheck (rule 4)", { preconditionHolds: false }, "preconditionStale"],
        [
            "newer human change (rule 5)",
            { latestHumanChangeAt: new Date("2026-07-01T00:00:01Z") },
            "newerHumanChange",
        ],
        ["disabled mode", { mode: "disabled" as const }, "modeDisabled"],
    ])("refuses on %s", (_name, override, code) => {
        const verdict = evaluateWrite(request(), context(override));
        expect(verdict).toMatchObject({ outcome: "refuse", code });
    });

    it("the check precedence is contract: the earliest failing rule names the code", () => {
        // Everything fails at once; the kill switch is reported.
        const verdict = evaluateWrite(
            request(),
            context({
                killSwitchActive: true,
                capabilityEnabled: false,
                installationHasPermission: false,
                itemBlocked: true,
                preconditionHolds: false,
                mode: "disabled",
            }),
        );
        expect(verdict).toMatchObject({ outcome: "refuse", code: "killSwitch" });
    });

    it.each(["observe", "dry-run"] as const)(
        "%s mode records instead of applying (rule 10)",
        (mode) => {
            const verdict = evaluateWrite(request(), context({ mode }));
            expect(verdict).toMatchObject({ outcome: "record-only", code: "modeRecordsOnly" });
        },
    );

    it("observations never require enablement or permission", () => {
        const verdict = evaluateWrite(
            request({ actionClass: "observation" }),
            context({ capabilityEnabled: false, installationHasPermission: false }),
        );
        expect(verdict).toMatchObject({ outcome: "record-only", code: "observation" });
    });

    it("a human change at the exact cause instant refuses — ties go to the human", () => {
        // FINDING(safety-human-tie): causeObservedAt is 2026-07-01T00:00:00Z.
        const verdict = evaluateWrite(
            request(),
            context({ latestHumanChangeAt: new Date("2026-07-01T00:00:00Z") }),
        );
        expect(verdict.outcome).toBe("refuse");
    });

    it("a human change older than the cause does not conflict", () => {
        const verdict = evaluateWrite(
            request(),
            context({ latestHumanChangeAt: new Date("2026-06-30T23:59:59Z") }),
        );
        expect(verdict).toEqual({ outcome: "apply" });
    });

    it.each([
        ["an invalid cause timestamp", request({ causeObservedAt: new Date("invalid") }), context({
            latestHumanChangeAt: new Date("2026-06-30T23:59:59Z"),
        })],
        ["an invalid human-change timestamp", request(), context({
            latestHumanChangeAt: new Date("invalid"),
        })],
    ] as const)("fails closed on %s", (_name, badRequest, badContext) => {
        const verdict = evaluateWrite(badRequest, badContext);
        expect(verdict).toMatchObject({
            outcome: "refuse",
            code: "invalidTimestamp",
        });
        if (verdict.outcome === "refuse") {
            expect(verdict.reason.length).toBeGreaterThan(0);
        }
    });

    // FINDING(safety-killswitch-observations)
    it("the kill switch beats everything, including observations", () => {
        const verdict = evaluateWrite(
            request({ actionClass: "observation" }),
            context({ killSwitchActive: true }),
        );
        expect(verdict).toMatchObject({ outcome: "refuse", code: "killSwitch" });
    });
});

describe("audit findings, pinned (D51-D53)", () => {
    /**
     * D52 — the headline: the §3 gates must be inescapable, not a
     * calling convention. Before this, the same call answered `apply`.
     */
    it("evaluateWrite refuses a destructive request instead of applying it", () => {
        const verdict = evaluateWrite(
            request({ actionClass: "clockTriggeredDestructive", capability: "assignment" }),
            context(),
        );
        expect(verdict).toMatchObject({ outcome: "refuse", code: "wrongEntryPoint" });
    });

    it("no context can make evaluateWrite apply a destructive request", () => {
        for (const mode of REPOSITORY_MODES) {
            expect(
                evaluateWrite(
                    request({ actionClass: "clockTriggeredDestructive" }),
                    context({ mode }),
                ).outcome,
            ).toBe("refuse");
        }
    });

    // D51 — unknown ordering is a conflict, not an absence.
    it("unestablished human-change ordering refuses (manual-edits.md §2)", () => {
        expect(
            evaluateWrite(request(), context({ latestHumanChangeAt: "unknown" })),
        ).toMatchObject({ outcome: "refuse", code: "humanOrderingUnknown" });
    });

    it("null still means CHECKED-and-none, and still applies", () => {
        expect(
            evaluateWrite(request(), context({ latestHumanChangeAt: null })),
        ).toEqual({ outcome: "apply" });
    });

    it("unknown ordering also stops a fully-warranted destructive action", () => {
        const destructiveRequest = request({
            actionClass: "clockTriggeredDestructive",
            capability: "inactivity",
        });
        const plan: DestructivePlan = {
            request: destructiveRequest,
            warning: warningFor(destructiveRequest),
            qualifyingActivitySinceWarning: false,
        };
        expect(
            evaluateDestructive(
                plan,
                context({ capability: "inactivity", latestHumanChangeAt: "unknown" }),
                new Date("2026-08-01T00:00:00Z"),
            ),
        ).toMatchObject({ outcome: "refuse", code: "humanOrderingUnknown" });
    });

    // D52 — the kill switch is reported FIRST on the destructive path too.
    it("an active kill switch is reported as killSwitch, not noWarning", () => {
        expect(
            evaluateDestructive(
                {
                    request: request({
                        actionClass: "clockTriggeredDestructive",
                        capability: "inactivity",
                    }),
                    warning: null,
                    qualifyingActivitySinceWarning: false,
                },
                context({ capability: "inactivity", killSwitchActive: true }),
                new Date("2026-08-01T00:00:00Z"),
            ),
        ).toMatchObject({ outcome: "refuse", code: "killSwitch" });
    });

    it("refuses immediate preventive actions until their explanation and reversal gate exists", () => {
        expect(
            evaluateWrite(
                request({
                    actionClass: "immediatePreventive",
                    capability: "intake",
                    target: { item: "issue #42", change: "lock pending moderation" },
                }),
                context({ capability: "intake" }),
            ),
        ).toMatchObject({ outcome: "refuse", code: "preventiveGateUnavailable" });
    });

    it("a destructive capability mismatch is reported before plan policy", () => {
        expect(
            evaluateDestructive(
                {
                    request: request({
                        actionClass: "clockTriggeredDestructive",
                        capability: "inactivity",
                    }),
                    warning: null,
                    qualifyingActivitySinceWarning: false,
                },
                context({ capability: "assignment" }),
                new Date("2026-08-01T00:00:00Z"),
            ),
        ).toMatchObject({ outcome: "refuse", code: "capabilityMismatch" });
    });
});

describe("evaluateDestructive (safety.md §3–§4)", () => {
    /**
     * These plans are from the `inactivity` capability, so the rechecked
     * context must describe that same capability — D53's link check
     * refuses a context about a different one.
     */
    const dContext = (over?: Partial<WriteContext>): WriteContext =>
        context({ capability: "inactivity", ...over });

    const destructive = (over?: Partial<DestructivePlan>): DestructivePlan => {
        const destructiveRequest = request({
            actionClass: "clockTriggeredDestructive",
            capability: "inactivity",
            cause: "no qualifying activity for 21 days",
        });
        return {
            request: destructiveRequest,
            warning: warningFor(destructiveRequest),
            qualifyingActivitySinceWarning: false,
            ...over,
        };
    };

    const afterGrace = new Date("2026-07-09T00:00:00Z"); // 8 days later
    const duringGrace = new Date("2026-07-05T00:00:00Z"); // 4 days later

    it("never acts on first observation — a missing warning refuses", () => {
        const verdict = evaluateDestructive(
            destructive({ warning: null }),
            dContext(),
            afterGrace,
        );
        expect(verdict).toMatchObject({ outcome: "refuse", code: "noWarning" });
    });

    it("refuses while the grace period is running", () => {
        expect(
            evaluateDestructive(destructive(), dContext(), duringGrace),
        ).toMatchObject({ outcome: "refuse", code: "graceRunning" });
    });

    it("refuses when the affected person was active during the grace period", () => {
        expect(
            evaluateDestructive(
                destructive({ qualifyingActivitySinceWarning: true }),
                dContext(),
                afterGrace,
            ),
        ).toMatchObject({ outcome: "refuse", code: "activityCancelled" });
    });

    it("refuses warning reuse across capabilities, targets, and causes", () => {
        const plan = destructive();
        const mismatches: readonly [WriteRequest, WriteContext][] = [
            [
                { ...plan.request, target: { ...plan.request.target, item: "issue #999" } },
                dContext(),
            ],
            [
                { ...plan.request, target: { ...plan.request.target, change: "unassign" } },
                dContext(),
            ],
            [{ ...plan.request, cause: "a different inactivity observation" }, dContext()],
            [
                { ...plan.request, causeObservedAt: new Date("2026-07-01T00:00:01Z") },
                dContext(),
            ],
            [{ ...plan.request, capability: "anotherCapability" }, dContext({ capability: "anotherCapability" })],
        ];
        for (const [mismatchedRequest, matchingContext] of mismatches) {
            const verdict = evaluateDestructive(
                { ...plan, request: mismatchedRequest },
                matchingContext,
                afterGrace,
            );
            expect(verdict).toMatchObject({ outcome: "refuse", code: "warningRequestMismatch" });
            if (verdict.outcome === "refuse") expect(verdict.reason.length).toBeGreaterThan(0);
        }

        const wrongClass = evaluateDestructive(
            {
                ...plan,
                warning: warningFor({
                    ...plan.request,
                    actionClass: "reversibleStateChange",
                }),
            },
            dContext(),
            afterGrace,
        );
        expect(wrongClass).toMatchObject({ outcome: "refuse", code: "warningRequestMismatch" });
    });

    it("refuses inconsistent or incomplete warning metadata", () => {
        const plan = destructive();
        const invalidWarnings: readonly DestructiveWarning[] = [
            warningFor(plan.request, {
                warnedAt: new Date("2026-06-30T23:59:59Z"),
            }),
            warningFor(plan.request, {
                earliestActionAt: new Date("2026-07-07T23:59:59Z"),
            }),
            warningFor(plan.request, { cancelledBy: "   " }),
            warningFor(plan.request, { reversesWith: "   " }),
        ];
        for (const warning of invalidWarnings) {
            const verdict = evaluateDestructive(
                { ...plan, warning },
                dContext(),
                afterGrace,
            );
            expect(verdict).toMatchObject({ outcome: "refuse", code: "invalidDestructivePlan" });
            if (verdict.outcome === "refuse") expect(verdict.reason.length).toBeGreaterThan(0);
        }
    });

    it.each([0, -1, MIN_GRACE_DAYS - 1])(
        "refuses a grace period of %s days (§4 floor)",
        (days) => {
            const plan = destructive();
            const verdict = evaluateDestructive(
                {
                    ...plan,
                    warning: { ...plan.warning!, gracePeriodDays: days },
                },
                dContext(),
                afterGrace,
            );
            expect(verdict).toMatchObject({ outcome: "refuse", code: "graceBelowFloor" });
        },
    );

    it.each([
        ["a non-finite grace period", Number.NaN, new Date("2026-07-01T00:00:00Z"), afterGrace],
        ["an invalid warning timestamp", 7, new Date("invalid"), afterGrace],
        ["an invalid current timestamp", 7, new Date("2026-07-01T00:00:00Z"), new Date("invalid")],
    ] as const)("fails closed on %s", (_name, gracePeriodDays, warnedAt, now) => {
        const plan = destructive();
        const verdict = evaluateDestructive(
                {
                    ...plan,
                    warning: { ...plan.warning!, gracePeriodDays, warnedAt },
                },
                dContext(),
                now,
            );
        expect(verdict).toMatchObject({
            outcome: "refuse",
            code: "invalidDestructivePlan",
        });
        if (verdict.outcome === "refuse") {
            expect(verdict.reason.length).toBeGreaterThan(0);
        }
    });

    // Mutation-testing survivors, now pinned — both boundaries exact:
    it("a grace period exactly at the floor is legal, and acts exactly when it elapses", () => {
        const plan = destructive();
        const atFloor = {
            ...plan,
            warning: {
                ...plan.warning!,
                gracePeriodDays: MIN_GRACE_DAYS,
                earliestActionAt: new Date("2026-07-02T00:00:00Z"),
            },
        };
        // warnedAt 2026-07-01T00:00:00Z + exactly MIN_GRACE_DAYS days:
        // the grace has fully elapsed at this instant, not one ms later.
        expect(
            evaluateDestructive(atFloor, dContext(), new Date("2026-07-02T00:00:00Z")).outcome,
        ).toBe("apply");
        expect(
            evaluateDestructive(atFloor, dContext(), new Date("2026-07-01T23:59:59.999Z")),
        ).toMatchObject({ outcome: "refuse", code: "graceRunning" });
    });

    it("a warned, elapsed, quiet, unblocked plan still respects repository mode", () => {
        expect(
            evaluateDestructive(destructive(), dContext({ mode: "dry-run" }), afterGrace)
                .outcome,
        ).toBe("record-only");
        expect(
            evaluateDestructive(destructive(), dContext(), afterGrace).outcome,
        ).toBe("apply");
    });

    it("a human change during the grace period cancels the plan (rule 5)", () => {
        expect(
            evaluateDestructive(
                destructive(),
                dContext({ latestHumanChangeAt: new Date("2026-07-05T12:00:00Z") }),
                afterGrace,
            ).outcome,
        ).toBe("refuse");
    });

    it("every destructive refusal carries a non-empty human reason", () => {
        const plan = destructive();
        const refusals = [
            evaluateDestructive(destructive({ warning: null }), dContext(), afterGrace),
            evaluateDestructive(destructive(), dContext(), duringGrace),
            evaluateDestructive(destructive({ qualifyingActivitySinceWarning: true }), dContext(), afterGrace),
            evaluateDestructive({ ...plan, warning: { ...plan.warning!, gracePeriodDays: 0 } }, dContext(), afterGrace),
            evaluateDestructive({ ...plan, request: request() }, context(), afterGrace),
        ];
        for (const verdict of refusals) {
            expect(verdict.outcome).toBe("refuse");
            if (verdict.outcome === "refuse") expect(verdict.reason.length).toBeGreaterThan(0);
        }
        // And the observation record-only verdict explains itself too.
        // `context()` here, not `dContext()`: `request()` defaults to the
        // `assignment` capability, and D53's link check runs BEFORE the
        // observation short-circuit — a request and context describing
        // different capabilities is malformed input, not a policy
        // question, so no action class is exempt from it.
        const observed = evaluateWrite(request({ actionClass: "observation" }), context());
        expect(observed).toMatchObject({ outcome: "record-only" });
        if (observed.outcome === "record-only") expect(observed.reason.length).toBeGreaterThan(0);
    });

    it("rejects a non-destructive request routed through the destructive path", () => {
        const plan = destructive();
        expect(
            evaluateDestructive(
                { ...plan, request: request() },
                context(),
                afterGrace,
            ),
        ).toMatchObject({ outcome: "refuse", code: "wrongActionClass" });
    });
});
