/**
 * The other write door — the effects.md ladder `evaluateDestructive` climbs: a
 * recorded warning, a warning that authorizes THIS request, a plan whose
 * metadata is coherent, the grace floor, the grace fully elapsed, no
 * qualifying activity. Each rung is refused on its own and the two grace
 * boundaries are pinned to the millisecond. The D51-D53 findings that
 * entered by this door are here; the general door's are in `write.test.ts`.
 */

import { describe, it, expect } from "vitest";
import {
    evaluateDestructive,
    createDestructiveWarning,
    MIN_GRACE_DAYS,
    type WriteRequest,
    type WriteContext,
    type DestructivePlan,
    type DestructiveWarning,
    type DestructiveWarningInput,
} from "../../src/safety/index.js";
import type { RepositoryConfig } from "../../src/config/index.js";
import { assertedWorld } from "../../src/safety/world.js";
import { anyCapability, config, context, evalWrite, request } from "./builders.js";

const evalDestructive = (
    plan: DestructivePlan,
    c: WriteContext,
    now: Date,
    cfg: RepositoryConfig = config(),
) => evaluateDestructive(plan, cfg, c, now);

const warningFor = (
    warnedRequest: WriteRequest,
    over?: Partial<Omit<DestructiveWarningInput, "request">>,
): DestructiveWarning =>
    createDestructiveWarning({
        request: warnedRequest,
        warnedAt: new Date("2026-07-01T00:00:00Z"),
        gracePeriodDays: 7,
        earliestActionAt: new Date("2026-07-08T00:00:00Z"),
        cancelledBy: "any comment or commit by the assignee",
        reversesWith: "a maintainer or author restores the previous state",
        ...over,
    });

describe("audit findings, pinned (D51-D53)", () => {
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
            evalDestructive(
                plan,
                context({ latestHumanChangeAt: "unknown" }),
                new Date("2026-08-01T00:00:00Z"),
                anyCapability("inactivity"),
            ),
        ).toMatchObject({ outcome: "refuse", code: "humanOrderingUnknown" });
    });

    // D52 — the kill switch is reported FIRST on the destructive path too.
    it("an active kill switch is reported as killSwitch, not noWarning", () => {
        expect(
            evalDestructive(
                {
                    request: request({
                        actionClass: "clockTriggeredDestructive",
                        capability: "inactivity",
                    }),
                    warning: null,
                    qualifyingActivitySinceWarning: false,
                },
                context({ killSwitchActive: true, world: assertedWorld([], false) }),
                new Date("2026-08-01T00:00:00Z"),
                anyCapability("inactivity"),
            ),
        ).toMatchObject({ outcome: "refuse", code: "killSwitch" });
    });

    it("unavailable authority is reported before destructive-plan policy", () => {
        expect(
            evalDestructive(
                {
                    request: request({
                        actionClass: "clockTriggeredDestructive",
                        capability: "inactivity",
                    }),
                    warning: null,
                    qualifyingActivitySinceWarning: false,
                },
                context({ world: assertedWorld([], false) }),
                new Date("2026-08-01T00:00:00Z"),
                anyCapability("inactivity"),
            ),
        ).toMatchObject({ outcome: "refuse", code: "preconditionStale" });
    });

    it("a destructive capability mismatch is reported before plan policy", () => {
        expect(
            evalDestructive(
                {
                    request: request({
                        actionClass: "clockTriggeredDestructive",
                        capability: "inactivity",
                    }),
                    warning: null,
                    qualifyingActivitySinceWarning: false,
                },
                context(),
                new Date("2026-08-01T00:00:00Z"),
                anyCapability("inactivity"),
            ),
        ).toMatchObject({ outcome: "refuse", code: "noWarning" });
    });
});

describe("evaluateDestructive (guides/effects.md)", () => {
    /**
     * These plans are from the `inactivity` capability, so the rechecked
     * context must describe that same capability — D53's link check
     * refuses a context about a different one.
     */
    const dConfig = anyCapability("inactivity");
    const dContext = (over?: Partial<WriteContext>): WriteContext => context(over);

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
        const verdict = evalDestructive(destructive({ warning: null }), dContext(), afterGrace);
        expect(verdict).toMatchObject({ outcome: "refuse", code: "noWarning" });
    });

    it("refuses while the grace period is running", () => {
        expect(evalDestructive(destructive(), dContext(), duringGrace)).toMatchObject({
            outcome: "refuse",
            code: "graceRunning",
        });
    });

    it("refuses when the affected person was active during the grace period", () => {
        expect(
            evalDestructive(
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
            [{ ...plan.request, causeObservedAt: new Date("2026-07-01T00:00:01Z") }, dContext()],
            [{ ...plan.request, capability: "anotherCapability" }, dContext()],
        ];
        for (const [mismatchedRequest, matchingContext] of mismatches) {
            const verdict = evalDestructive(
                { ...plan, request: mismatchedRequest },
                matchingContext,
                afterGrace,
            );
            expect(verdict).toMatchObject({ outcome: "refuse", code: "warningRequestMismatch" });
            if (verdict.outcome === "refuse") expect(verdict.reason.length).toBeGreaterThan(0);
        }

        const wrongClass = evalDestructive(
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

    it("warning issuance copies primitives so later request mutation cannot change its authority", () => {
        const aliasedRequest = request({
            actionClass: "clockTriggeredDestructive",
            capability: "inactivity",
            target: { item: "issue #1", change: "unassign alice" },
        });
        const warning = warningFor(aliasedRequest);
        expect(Object.isFrozen(warning)).toBe(true);
        expect(Object.isFrozen(warning.requestSnapshot)).toBe(true);

        const mutableTarget = aliasedRequest.target as { item: string; change: string };
        mutableTarget.item = "issue #999";
        mutableTarget.change = "close issue";
        aliasedRequest.causeObservedAt.setTime(new Date("2026-07-01T00:00:01Z").getTime());

        expect(
            evalDestructive(
                {
                    request: aliasedRequest,
                    warning,
                    qualifyingActivitySinceWarning: false,
                },
                context(),
                new Date("2026-07-09T00:00:00Z"),
                dConfig,
            ),
        ).toMatchObject({ outcome: "refuse", code: "warningRequestMismatch" });
        expect(warning.requestSnapshot).toMatchObject({
            item: "issue #1",
            change: "unassign alice",
            causeObservedAtMs: new Date("2026-07-01T00:00:00Z").getTime(),
        });
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
            const verdict = evalDestructive({ ...plan, warning }, dContext(), afterGrace);
            expect(verdict).toMatchObject({ outcome: "refuse", code: "invalidDestructivePlan" });
            if (verdict.outcome === "refuse") expect(verdict.reason.length).toBeGreaterThan(0);
        }
    });

    it.each([0, -1, MIN_GRACE_DAYS - 1])(
        "refuses a grace period of %s days (grace floor)",
        (days) => {
            const plan = destructive();
            const verdict = evalDestructive(
                {
                    ...plan,
                    warning: warningFor(plan.request, { gracePeriodDays: days }),
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
        const verdict = evalDestructive(
            {
                ...plan,
                warning: warningFor(plan.request, { gracePeriodDays, warnedAt }),
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
            warning: warningFor(plan.request, {
                gracePeriodDays: MIN_GRACE_DAYS,
                earliestActionAt: new Date("2026-07-02T00:00:00Z"),
            }),
        };
        // warnedAt 2026-07-01T00:00:00Z + exactly MIN_GRACE_DAYS days:
        // the grace has fully elapsed at this instant, not one ms later.
        expect(evalDestructive(atFloor, dContext(), new Date("2026-07-02T00:00:00Z")).outcome).toBe(
            "apply",
        );
        expect(
            evalDestructive(atFloor, dContext(), new Date("2026-07-01T23:59:59.999Z")),
        ).toMatchObject({ outcome: "refuse", code: "graceRunning" });
    });

    it("a warned, elapsed, quiet, unblocked plan still respects repository mode", () => {
        expect(
            evalDestructive(destructive(), dContext(), afterGrace, config({ mode: "dry-run" }))
                .outcome,
        ).toBe("record-only");
        expect(evalDestructive(destructive(), dContext(), afterGrace).outcome).toBe("apply");
    });

    it("a human change during the grace period cancels the plan (rule 5)", () => {
        expect(
            evalDestructive(
                destructive(),
                dContext({ latestHumanChangeAt: new Date("2026-07-05T12:00:00Z") }),
                afterGrace,
            ).outcome,
        ).toBe("refuse");
    });

    it("every destructive refusal carries a non-empty human reason", () => {
        const plan = destructive();
        const refusals = [
            evalDestructive(destructive({ warning: null }), dContext(), afterGrace),
            evalDestructive(destructive(), dContext(), duringGrace),
            evalDestructive(
                destructive({ qualifyingActivitySinceWarning: true }),
                dContext(),
                afterGrace,
            ),
            evalDestructive(
                { ...plan, warning: warningFor(plan.request, { gracePeriodDays: 0 }) },
                dContext(),
                afterGrace,
            ),
            evalDestructive({ ...plan, request: request() }, context(), afterGrace),
        ];
        for (const verdict of refusals) {
            expect(verdict.outcome).toBe("refuse");
            if (verdict.outcome === "refuse") expect(verdict.reason.length).toBeGreaterThan(0);
        }
        // And the observation record-only verdict explains itself too.
        // `context()` here, not `dContext()`: `request()` defaults to the
        // `assignment` capability, and D53's link check runs BEFORE the
        // observation short-circuit, so no action class is exempt from it.
        const observed = evalWrite(request({ actionClass: "observation" }), context());
        expect(observed).toMatchObject({ outcome: "record-only" });
        if (observed.outcome === "record-only") expect(observed.reason.length).toBeGreaterThan(0);
    });

    it("rejects a non-destructive request routed through the destructive path", () => {
        const plan = destructive();
        expect(
            evalDestructive({ ...plan, request: request() }, context(), afterGrace),
        ).toMatchObject({ outcome: "refuse", code: "wrongActionClass" });
    });
});
