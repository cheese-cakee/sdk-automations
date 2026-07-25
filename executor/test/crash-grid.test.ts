/**
 * The crash grid: every single crash point, every pair of crash
 * points, and seeded multi-crash histories — all must converge to the
 * same terminal state: effect complete, every call applied, the
 * non-idempotent call applied EXACTLY once. This is 6.5's hand-run
 * sandbox grid, exhaustive and repeatable.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "@hiero-hackers/automation-store";
import type { EffectPlan } from "../src/recovery.js";
import { runToConvergence, prng, type CrashMode } from "./harness.js";

const PLAN: EffectPlan = {
    effectId: "assign-issue-7",
    calls: [
        { seq: 1, intent: "list-comments", idempotencyClass: "idempotent" },
        { seq: 2, intent: "create-comment", idempotencyClass: "nonIdempotent" },
        { seq: 3, intent: "add-label", idempotencyClass: "idempotent" },
    ],
};

function inTmp<T>(fn: (path: string) => T): T {
    const dir = mkdtempSync(join(tmpdir(), "executor-grid-"));
    try {
        return fn(join(dir, "store.sqlite"));
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

function assertConverged(path: string, schedule: ReadonlyMap<number, CrashMode>): void {
    const { result, world } = runToConvergence(path, PLAN, schedule);
    expect(result).toEqual({ outcome: "complete" });
    for (const call of PLAN.calls) {
        expect(world.applications(PLAN, call)).toBeGreaterThanOrEqual(1);
    }
    // The invariant the whole design exists for: the non-idempotent
    // call landed exactly once, no matter where the crashes fell.
    expect(world.applications(PLAN, PLAN.calls[1]!)).toBe(1);
    // And the journal agrees the effect is closed.
    const store = new Store(path);
    expect(store.effectState(PLAN.effectId, PLAN.calls.length)).toEqual({ state: "complete" });
    store.close();
}

describe("single crash at every point", () => {
    const modes: CrashMode[] = ["beforeApply", "afterApply"];
    it.each(
        [1, 2, 3].flatMap((p) => modes.map((m) => [p, m] as const)),
    )("crash %i/%s converges with no duplicate", (invocation, mode) => {
        inTmp((path) => assertConverged(path, new Map([[invocation, mode]])));
    });
});

describe("every pair of crash points across two incarnations", () => {
    const modes: CrashMode[] = ["beforeApply", "afterApply"];
    const pairs: [number, CrashMode, number, CrashMode][] = [];
    for (let p1 = 1; p1 <= 4; p1++)
        for (const m1 of modes)
            for (let p2 = p1 + 1; p2 <= p1 + 4; p2++)
                for (const m2 of modes) pairs.push([p1, m1, p2, m2]);

    it(`all ${String(pairs.length)} pairs converge with no duplicate`, () => {
        for (const [p1, m1, p2, m2] of pairs) {
            inTmp((path) =>
                assertConverged(
                    path,
                    new Map([
                        [p1, m1],
                        [p2, m2],
                    ]),
                ),
            );
        }
    });
});

describe("seeded multi-crash histories", () => {
    it.each(Array.from({ length: 10 }, (_, i) => i + 1))(
        "seed %i — random crash schedule converges with no duplicate",
        (seed) => {
            const rand = prng(seed);
            // Each of the first 12 perform-invocations may crash.
            const schedule = new Map<number, CrashMode>();
            let crashes = 0;
            for (let invocation = 1; invocation <= 12 && crashes < 6; invocation++) {
                if (rand() < 0.35) {
                    schedule.set(invocation, rand() < 0.5 ? "beforeApply" : "afterApply");
                    crashes += 1;
                }
            }
            inTmp((path) => assertConverged(path, schedule));
        },
    );
});
