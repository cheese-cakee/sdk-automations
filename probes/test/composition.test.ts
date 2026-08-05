/**
 * The composition run: capability → planner → safety → store → executor,
 * end to end, with only GitHub faked.
 *
 * This is the test the three packages did not have. Each was verified
 * against its own source document in isolation, and until `planner.ts`
 * existed there was no path from an `evaluate` result to an `EffectPlan`
 * — so "the layers compose" was a claim about two documents agreeing,
 * not about two functions fitting. Everything here is the real code:
 * real `parseConfig`, real projection, real capabilities, real safety
 * engine, real SQLite store, real recovery loop. The fake stops at the
 * port, exactly where the crash grid puts it.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "@hiero-hackers/automation-store";
import {
    RecoveryExecutor,
    planIntents,
    planningReport,
    type EffectPlan,
    type EffectPort,
    type PlannedCall,
} from "@hiero-hackers/automation-executor";
import {
    parseConfig,
    type AnyIntent,
    problems,
    type IssueMeaning,
    type ObservationProjection,
    type RepositoryConfig,
    type RepositoryMode,
    type WriteContext,
} from "@hiero-hackers/automation-core";
import { inactivity, intake } from "../src/index.js";
import { configEnabling, runEnabled, type ProbeCapability } from "./world.js";

let dir: string;
let path: string;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "probe-compose-"));
    path = join(dir, "store.sqlite");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const AT = new Date("2026-08-03T09:00:00.000Z");
const NOW = new Date("2026-08-03T09:00:05.000Z");
const REPO = { owner: "hiero-hackers", repo: "sandbox" } as const;
const NAMES = ["intake", "inactivity"];
const REVISION = "rev-1";  // now stamped on the config itself (D77)

/** Counts applications per call — the reference model for exactly-once. */
class CountingPort implements EffectPort {
    readonly applied: string[] = [];
    private failNext = new Set<string>();

    private key(plan: EffectPlan, call: PlannedCall) {
        return `${plan.effectId}#${String(call.seq)}`;
    }
    crashOn(plan: EffectPlan, call: PlannedCall) {
        this.failNext.add(this.key(plan, call));
    }
    async perform(plan: EffectPlan, call: PlannedCall): Promise<void> {
        const k = this.key(plan, call);
        this.applied.push(k);
        if (this.failNext.has(k)) {
            this.failNext.delete(k);
            // The response is lost AFTER the write landed — 6.5's case.
            throw new Error("connection reset");
        }
    }
    async readBack(plan: EffectPlan, call: PlannedCall) {
        return this.applied.includes(this.key(plan, call))
            ? ("present" as const)
            : ("absent" as const);
    }
}

/**
 * Everything holds; the shell's rechecked facts in the happy case.
 *
 * The mode used to be a parameter here, because the context carried a copy
 * of it and the copy could disagree with the reviewed file. D73 removed the
 * copy — mode and enablement are read from the configuration — so this
 * helper now supplies only facts a shell genuinely has to recheck.
 */
const permissive =
    () =>
    (_intent: AnyIntent): WriteContext => ({
        installationGrants: ["issues:write"],
        killSwitchActive: false,
        observedMeanings: [],
        preconditionHolds: true,
        latestHumanChangeAt: null,
    });

const issueObservation = {
    kind: "issueUpdated",
    repository: REPO,
    item: { kind: "issue", number: 11 },
    position: {
        kind: "position",
        state: { meaning: null, blocked: false, closedBy: null },
        ignored: [],
    },
    observedAt: AT,
} as const;

async function intentsFrom(
    capability: ProbeCapability,
    config: RepositoryConfig,
    observation: Parameters<typeof runEnabled>[2],
): Promise<readonly AnyIntent[]> {
    const records = await runEnabled([capability], config, observation, {
        isAutomationActor: { ok: true, value: false },
    });
    return records.flatMap((r) => r.intents);
}

describe("capability → planner → executor", () => {
    it("carries an intake decision all the way to an applied effect", async () => {
        const config = configEnabling(NAMES, NAMES, {
            intake: { announce: true },
        });
        const intents = await intentsFrom(intake, config, issueObservation);
        expect(intents).toHaveLength(2); // label + announcement

        const result = planIntents(intents, {
            declaration: intake.declaration,
            config,
            contextFor: permissive(),
            now: NOW,
        });
        expect(result.dispositions.every((d) => d.kind === "plan")).toBe(true);

        // One intent, one plan — independently claimable and recoverable.
        expect(result.plans).toHaveLength(2);
        expect(new Set(result.plans.map((p) => p.effectId)).size).toBe(2);

        const store = new Store(path);
        const port = new CountingPort();
        const executor = new RecoveryExecutor(
            store,
            port,
            "worker-1",
            () => NOW.toISOString(),
        );
        for (const plan of result.plans) {
            expect(await executor.runEffect(plan)).toEqual({ outcome: "complete" });
        }
        expect(port.applied).toHaveLength(2);
        for (const plan of result.plans) {
            expect(store.effectState(plan.effectId, 1).state).toBe("complete");
        }
    });

    it("re-planning the same observation is exactly-once across a crash", async () => {
        const config = configEnabling(NAMES, NAMES, { intake: { announce: false } });
        const plan = planIntents(
            await intentsFrom(intake, config, issueObservation),
            {
                declaration: intake.declaration,
                config,
                contextFor: permissive(),
                now: NOW,
            },
        ).plans[0]!;

        const port = new CountingPort();
        port.crashOn(plan, plan.calls[0]!);

        // First process dies mid-call; the claim is never released.
        const first = new Store(path);
        await expect(
            new RecoveryExecutor(first, port, "w1", () => NOW.toISOString()).runEffect(
                plan,
            ),
        ).rejects.toThrow("connection reset");

        // The restarted process takes the stale lease over and resolves.
        const later = new Date(NOW.getTime() + 30 * 60 * 1000);
        const second = new Store(path);
        const result = await new RecoveryExecutor(
            second,
            port,
            "w2",
            () => later.toISOString(),
        ).runEffect(plan);

        expect(result).toEqual({ outcome: "complete" });
        // The read-back found the landed write; it was never re-sent.
        expect(port.applied).toEqual([`${plan.effectId}#1`]);
    });

    /**
     * The idempotency key is what makes redelivery safe, so it must be
     * stable across an independent re-evaluation of the same event.
     */
    it("a redelivered event re-derives the same effect identity", async () => {
        const config = configEnabling(NAMES, NAMES, { intake: { announce: false } });
        const once = await intentsFrom(intake, config, issueObservation);
        const twice = await intentsFrom(intake, config, issueObservation);
        expect(twice[0]!.idempotencyKey).toBe(once[0]!.idempotencyKey);
    });
});

describe("the safety engine is on the path, not beside it", () => {
    const planFor = async (
        context: (intent: AnyIntent) => WriteContext,
        mode: RepositoryMode = "active",
    ) => {
        const raw = parseConfig(
            {
                schemaVersion: 1,
                mode,
                capabilities: { intake: { enabled: true, settings: {} } },
                mappings: { labels: { awaitingTriage: "status: triage" } },
                principals: {},
            },
            { revision: "rev-test", knownCapabilities: NAMES },
        );
        if (!raw.ok) throw new Error(raw.errors.map((e) => e.message).join("; "));
        return planIntents(await intentsFrom(intake, raw.config, issueObservation), {
            declaration: intake.declaration,
            config: raw.config,
            contextFor: context,
            now: NOW,
        });
    };

    it("refuses every intent when a kill switch is active", async () => {
        const result = await planFor((intent) => ({
            ...permissive()(intent),
            killSwitchActive: true,
        }));
        expect(result.plans).toEqual([]);
        expect(result.dispositions[0]).toMatchObject({
            kind: "refuse",
            code: "killSwitch",
        });
    });

    it("refuses when a human changed the item at or after the cause", async () => {
        const result = await planFor((intent) => ({
            ...permissive()(intent),
            latestHumanChangeAt: AT,
        }));
        expect(result.dispositions[0]).toMatchObject({
            kind: "refuse",
            code: "newerHumanChange",
        });
    });

    /**
     * Dry-run must stop BEFORE a plan exists. A journalled plan for a
     * write that will never be attempted becomes an open intent the
     * recovery loop is obliged to resolve — manufactured operator work
     * out of a mode whose entire promise is that nothing happens.
     */
    it("dry-run records the intent and writes nothing to the store", async () => {
        const result = await planFor(permissive(), "dry-run");
        expect(result.plans).toEqual([]);
        expect(result.dispositions[0]).toMatchObject({
            kind: "record",
            code: "modeRecordsOnly",
        });

        const store = new Store(path);
        for (const d of result.dispositions) {
            expect(d.kind).not.toBe("plan");
        }
        expect(store.openIntents(NOW.toISOString())).toEqual([]);
    });

    /**
     * The `modeMismatch` test lived here and is deliberately gone. It pinned
     * a shell whose rechecked context disagreed with the reviewed file about
     * mode — a state D73 made unconstructible, because the context no longer
     * carries a mode to disagree with. The guard, its refusal code, and this
     * test all retired together.
     */
});

describe("the destructive path", () => {
    const staleObservation = (warnedAt: Date | null) =>
        ({
            kind: "staleItemsDue",
            repository: REPO,
            items: [
                {
                    item: { kind: "issue", number: 13 },
                    assignee: "contributor",
                    lastHumanActivityAt: new Date("2026-07-01T00:00:00.000Z"),
                    warnedAt,
                },
            ],
            observedAt: AT,
        }) as const;

    const planStale = async (warnedAt: Date | null, now: Date) => {
        const config = configEnabling(NAMES, NAMES, {
            inactivity: { gracePeriodDays: 7 },
        });
        return planIntents(
            await intentsFrom(inactivity, config, staleObservation(warnedAt)),
            {
                declaration: inactivity.declaration,
                config,
                contextFor: permissive(),
                now,
            },
        );
    };

    /**
     * The teeth behind FINDING(runtime-warning-cannot-cross-the-store).
     * The planner rebuilds the branded warning from the STORED warned
     * cause; if it rebuilt from the current request instead, D60's
     * snapshot check would compare a value with itself and this test
     * could not fail. A capability whose act cites a different causal
     * observation than it warned about is refused.
     */
    it("refuses a reclaim whose cause is not the one the warning authorized", async () => {
        const warnedAt = new Date("2026-07-20T00:00:00.000Z");
        const config = configEnabling(NAMES, NAMES, {
            inactivity: { gracePeriodDays: 7 },
        });
        const [reclaim] = await intentsFrom(
            inactivity,
            config,
            staleObservation(warnedAt),
        );
        const drifted = {
            ...reclaim!,
            cause: { cause: "gracePeriodElapsed", observedAt: AT },
        } as AnyIntent;

        const result = planIntents([drifted], {
            declaration: inactivity.declaration,
            config,
            contextFor: permissive(),
            now: NOW,
        });
        expect(result.plans).toEqual([]);
        expect(result.dispositions[0]).toMatchObject({
            kind: "refuse",
            code: "warningRequestMismatch",
        });
    });

    it("warns on the first stale observation and never acts", async () => {
        const result = await planStale(null, NOW);
        expect(result.dispositions).toHaveLength(1);
        expect(result.dispositions[0]).toMatchObject({ kind: "plan" });
        expect(result.plans[0]!.calls[0]!.intent).toBe("postManagedComment");
    });

    it("refuses the reclaim while the grace period is still running", async () => {
        const warnedAt = new Date("2026-08-01T00:00:00.000Z"); // 2 days ago
        const result = await planStale(warnedAt, NOW);
        expect(result.plans).toEqual([]);
        expect(result.dispositions[0]).toMatchObject({
            kind: "refuse",
            code: "graceRunning",
        });
    });

    it("allows the reclaim once the full grace period has elapsed", async () => {
        const warnedAt = new Date("2026-07-20T00:00:00.000Z"); // 14 days ago
        const result = await planStale(warnedAt, NOW);
        expect(result.dispositions[0]).toMatchObject({ kind: "plan" });
        expect(result.plans[0]!.calls[0]!.intent).toBe("unassign");
    });

    it("cancels the reclaim when the assignee came back during the grace period", async () => {
        const config = configEnabling(NAMES, NAMES, {
            inactivity: { gracePeriodDays: 7 },
        });
        const observation = {
            kind: "staleItemsDue",
            repository: REPO,
            items: [
                {
                    item: { kind: "issue", number: 13 },
                    assignee: "contributor",
                    // Activity AFTER the warning cancels it (safety.md §3).
                    lastHumanActivityAt: new Date("2026-07-25T00:00:00.000Z"),
                    warnedAt: new Date("2026-07-20T00:00:00.000Z"),
                },
            ],
            observedAt: AT,
        } as const;
        const result = planIntents(
            await intentsFrom(inactivity, config, observation),
            {
                declaration: inactivity.declaration,
                config,
                contextFor: permissive(),
                now: NOW,
            },
        );
        expect(result.plans).toEqual([]);
        expect(result.dispositions[0]).toMatchObject({
            kind: "refuse",
            code: "activityCancelled",
        });
    });
});

describe("dry-run is now observable (Phase 1)", () => {
    /**
     * The gap this closes: D68 made dry-run stop at planning, which was
     * correct and produced nothing anyone could see. A mode whose entire
     * promise is "you can see what it would do" showed nothing, and stage
     * five's exit gate — "explains every proposed effect without changing
     * repository workflow state" — could have passed on silence.
     */
    it("a dry-run pass yields a readable report and still writes nothing", async () => {
        const raw = parseConfig(
            {
                schemaVersion: 1,
                mode: "dry-run",
                capabilities: { intake: { enabled: true, settings: { announce: true } } },
                mappings: { labels: { awaitingTriage: "status: triage" } },
                principals: {},
            },
            { revision: "rev-test", knownCapabilities: NAMES },
        );
        if (!raw.ok) throw new Error(raw.errors.map((e) => e.message).join("; "));

        const result = planIntents(
            await intentsFrom(intake, raw.config, issueObservation),
            {
                declaration: intake.declaration,
                config: raw.config,
                contextFor: permissive(),
                now: NOW,
            },
        );
        const report = planningReport(result, REPO, "dry-run", REVISION);

        // Nothing was planned, so nothing can be journalled.
        expect(result.plans).toEqual([]);
        const store = new Store(path);
        expect(store.openIntents(NOW.toISOString())).toEqual([]);

        // But the pass is no longer silent: every intent is accounted for,
        // each says what it would have done, and none reads as a failure.
        expect(report.findings).toHaveLength(result.dispositions.length);
        expect(report.findings.length).toBeGreaterThan(0);
        expect(report.findings.every((f) => f.severity === "notice")).toBe(true);
        expect(problems(report)).toEqual([]);
        for (const f of report.findings) {
            expect(f.summary.length).toBeGreaterThan(0);
            expect(f.subject.kind).toBe("effect");
        }
        expect(report.revision).toBe(REVISION);
    });
});

describe("a conflicted item reaches the capability as a conflict (D81)", () => {
    /**
     * Before D81 this observation was indistinguishable from a clean one: the
     * payload carried a bare meaning list, so `intake` saw two meanings, read
     * "already positioned", and returned nothing — the right answer for the
     * wrong reason. Give it a conflict where the positions happen to be empty
     * and the old shape would have triaged it.
     */
    const conflicted = {
        kind: "issueUpdated",
        repository: REPO,
        item: { kind: "issue", number: 11 },
        position: {
            kind: "conflict",
            positions: ["ready", "inProgress"],
            blocked: false,
            closedBy: null,
            ignored: [],
        } as ObservationProjection<IssueMeaning>,
        observedAt: AT,
    } as const;

    it("intake declines, and says why", async () => {
        const config = configEnabling(NAMES, NAMES, { intake: { announce: true } });
        const records = await runEnabled([intake], config, conflicted, {});
        expect(records).toHaveLength(1);
        expect(records[0]!.intents).toEqual([]);
        const said = records[0]!.explanations.map((e) => e.summary).join(" ");
        expect(said).toContain("more than one workflow position");
    });

    it("the same item with a clean projection is triaged", async () => {
        const config = configEnabling(NAMES, NAMES, { intake: { announce: false } });
        const clean = {
            ...conflicted,
            position: {
                kind: "position",
                state: { meaning: null, blocked: false, closedBy: null },
                ignored: [],
            } as ObservationProjection<IssueMeaning>,
        } as const;
        const records = await runEnabled([intake], config, clean, {});
        expect(records[0]!.intents).toHaveLength(1);
        expect(records[0]!.intents[0]!.operation).toBe("applyMappedLabel");
    });
});
