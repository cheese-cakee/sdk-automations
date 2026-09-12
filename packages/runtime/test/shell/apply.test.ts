/**
 * The write path's one promise: whatever a crash, a lost response or a
 * concurrent human does, the repository is changed at most once and the
 * journal always says which.
 *
 * Every case here is a claim about a WINDOW — a named point between the
 * journal, the send and the acknowledgement — and the fake GitHub in
 * `effect-harness.ts` is what puts a crash inside one. A test that asserted
 * only the final world would pass for a path that sent twice and got lucky,
 * so the assertions are on the calls made as well as the world reached.
 *
 * The store is real, on a temp file, because the journal is the mechanism
 * under test. Two suites reopen it from disk mid-test: that is the closest
 * this package can honestly get to a killed worker, and it is what proves the
 * rows survive the process that wrote them.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Store } from "../../src/store/index.js";
import { useTempDir } from "@hiero-hackers/automation-testkit";
import {
    createApplier,
    EFFECT_ATTEMPT_CAP,
    EFFECT_LEASE_STALE_MINUTES,
    type Applier,
    type EffectExternalsSource,
} from "../../src/shell/apply.js";
import type { EffectOutcome } from "../../src/shell/effects.js";
import { serializeCall } from "../../src/shell/operations/index.js";
import { stubbedExternals } from "../../src/shell/externals.js";
import type { Log, ShellEvent } from "../../src/shell/log.js";
import {
    ACT_EFFECT_ID,
    appComment,
    appComments,
    BASE,
    callsOf,
    CAUSE_AT,
    commentEffect,
    configFor,
    configWithCapabilityOff,
    copiedComment,
    fakeGitHub,
    ITEM,
    labelEffect,
    markerOf,
    READY_LABEL,
    releaseEffect,
    TRIAGE_LABEL,
    warningEffect,
    type FakeGitHub,
} from "./effect-harness.js";

const WORKER = "worker-1";
const FUTURE = new Date(BASE.getTime() + 60 * 60_000).toISOString();

let logged: ShellEvent[] = [];
const log: Log = (event) => logged.push(event);

const temp = useTempDir("shell-apply-");
let storePath: string;
let store: Store;

beforeEach(() => {
    logged = [];
    storePath = temp.file("store.sqlite");
    store = new Store(storePath);
});
afterEach(() => {
    store.close();
});

interface ApplierOverrides {
    readonly externals?: EffectExternalsSource;
    readonly clock?: () => Date;
    readonly worker?: string;
    readonly store?: Store;
}

function applierOver(github: FakeGitHub, overrides: ApplierOverrides = {}): Applier {
    return createApplier({
        store: overrides.store ?? store,
        writer: github.writer,
        reader: github.reader,
        externals: overrides.externals ?? (() => stubbedExternals()),
        worker: overrides.worker ?? WORKER,
        clock: overrides.clock ?? (() => BASE),
        log,
    });
}

const keyOf = (effect: ReturnType<typeof labelEffect>): string => effect.intent.idempotencyKey;

/** Whether the effect's lease is free — the probe claim only inserts if it is. */
const leaseIsFree = (effectId: string): boolean =>
    store.claim(
        effectId,
        "probe",
        BASE.toISOString(),
        new Date(BASE.getTime() - EFFECT_LEASE_STALE_MINUTES * 60_000).toISOString(),
    );

const one = (outcomes: readonly EffectOutcome[]): EffectOutcome => {
    expect(outcomes).toHaveLength(1);
    return outcomes[0]!;
};

// ─── The fresh path ──────────────────────────────────────────────────

describe("an effect nothing has started", () => {
    it("re-gates, journals, sends and proves the postcondition", async () => {
        const github = fakeGitHub();
        const effect = labelEffect({ meaning: "ready" });

        const outcome = one(await applierOver(github).applyAll([effect], configFor()));

        expect(outcome).toEqual({
            effectId: keyOf(effect),
            capability: "intake",
            operation: "applyMappedLabel",
            item: ITEM,
            outcome: "applied",
            code: null,
            detail: null,
        });
        expect(github.calls).toEqual([`addLabel ${READY_LABEL}`]);
        expect(github.world.labels).toEqual([READY_LABEL]);
        expect(store.effectState(keyOf(effect), 1)).toMatchObject({ state: "complete" });
    });

    it("says `already` when GitHub reports the postcondition already held", async () => {
        const github = fakeGitHub({ labels: [READY_LABEL] });
        github.faults.scripted = [{ outcome: "already" }];
        const effect = labelEffect({ meaning: "ready" });

        const outcome = one(await applierOver(github).applyAll([effect], configFor()));

        expect(outcome).toMatchObject({ outcome: "already", code: null });
    });

    it("never sends again once the journal says the plan is complete", async () => {
        const github = fakeGitHub();
        const effect = labelEffect({ meaning: "ready" });
        const applier = applierOver(github);

        await applier.applyAll([effect], configFor());
        const second = one(await applier.applyAll([effect], configFor()));

        expect(second).toMatchObject({
            outcome: "already",
            detail: "the journal says every call in this effect's plan is done",
        });
        expect(github.calls).toHaveLength(1);
    });

    it("journals the configuration revision the decision was made under", async () => {
        const github = fakeGitHub();
        github.faults.scripted = [{ outcome: "retryLater", detail: "rate limited" }];
        const effect = labelEffect({ meaning: "ready" });

        await applierOver(github).applyAll([effect], configFor("active", "rev-abc"));

        expect(store.effectState(keyOf(effect), 1)).toMatchObject({
            state: "sentUnknown",
            revision: "rev-abc",
        });
    });

    it("does not resend an open call after the configuration changes", async () => {
        const github = fakeGitHub();
        github.faults.scripted = [{ outcome: "retryLater", detail: "rate limited" }];
        const effect = labelEffect({ meaning: "ready" });
        const applier = applierOver(github);

        await applier.applyAll([effect], configFor("active", "rev-a"));
        const outcome = one(await applier.applyAll([effect], configFor("active", "rev-b")));

        expect(outcome).toMatchObject({ outcome: "refused", code: "configurationChanged" });
        expect(callsOf(github, "addLabel")).toHaveLength(1);
        expect(store.openIntents(FUTURE)).toEqual([]);
    });

    it("applies each approved effect in turn, in the order it was approved", async () => {
        const github = fakeGitHub();

        const outcomes = await applierOver(github).applyAll(
            [labelEffect({ meaning: "ready" }), commentEffect({ body: "hello" })],
            configFor(),
        );

        expect(outcomes.map((o) => o.operation)).toEqual([
            "applyMappedLabel",
            "postManagedComment",
        ]);
        expect(github.calls.map((call) => call.split(" ")[0])).toEqual([
            "addLabel",
            "createComment",
        ]);
    });

    it("refuses a plan it cannot build, and journals nothing", async () => {
        const github = fakeGitHub();
        const effect = labelEffect({ meaning: "inProgress" });

        const outcome = one(await applierOver(github).applyAll([effect], configFor()));

        expect(outcome).toMatchObject({ outcome: "refused", code: "labelUnmapped" });
        expect(github.calls).toEqual([]);
        expect(store.effectState(keyOf(effect), 1)).toEqual({ state: "neverStarted" });
    });
});

// ─── Case 1: the three crash windows ─────────────────────────────────

describe("a crash at each window between deciding and acknowledging", () => {
    /** Window 1: the process died before the journal row existed. */
    it("leaves the journal empty, so the next pass is a fresh one", async () => {
        const github = fakeGitHub();
        github.faults.itemReadThrows = true;
        const effect = commentEffect({ body: "hello" });

        await expect(applierOver(github).applyAll([effect], configFor())).rejects.toThrow(
            "the item read seam broke",
        );

        expect(store.effectState(keyOf(effect), 1)).toEqual({ state: "neverStarted" });
        expect(github.calls).toEqual([]);
        expect(leaseIsFree(keyOf(effect))).toBe(true);

        store.release(keyOf(effect), "probe");
        github.faults.itemReadThrows = false;
        const outcome = one(await applierOver(github).applyAll([effect], configFor()));

        expect(outcome).toMatchObject({ outcome: "applied" });
        expect(callsOf(github, "createComment")).toHaveLength(1);
        expect(appComments(github)).toHaveLength(1);
    });

    /** Window 2: journalled, then died before GitHub saw anything. */
    it("resends a call the read-back proves never landed", async () => {
        const github = fakeGitHub();
        github.faults.crashOn = { verb: "createComment", when: "beforeSend" };
        const effect = commentEffect({ body: "hello" });

        await expect(applierOver(github).applyAll([effect], configFor())).rejects.toThrow(
            "crash before createComment",
        );

        expect(store.effectState(keyOf(effect), 1)).toMatchObject({ state: "sentUnknown", seq: 1 });
        expect(appComments(github)).toEqual([]);

        github.faults.crashOn = null;
        const outcome = one(await applierOver(github).applyAll([effect], configFor()));

        expect(outcome).toMatchObject({ outcome: "applied" });
        expect(appComments(github)).toHaveLength(1);
        expect(store.effectState(keyOf(effect), 1)).toMatchObject({ state: "complete" });
    });

    /** Window 3: GitHub had it, and the acknowledgement was lost. */
    it("closes a call the read-back finds already there, and sends nothing", async () => {
        const github = fakeGitHub();
        github.faults.crashOn = { verb: "createComment", when: "afterSend" };
        const effect = commentEffect({ body: "hello" });

        await expect(applierOver(github).applyAll([effect], configFor())).rejects.toThrow(
            "crash after createComment",
        );

        expect(store.effectState(keyOf(effect), 1)).toMatchObject({ state: "sentUnknown" });
        expect(appComments(github)).toHaveLength(1);

        github.faults.crashOn = null;
        const outcome = one(await applierOver(github).applyAll([effect], configFor()));

        expect(outcome).toMatchObject({ outcome: "applied" });
        expect(callsOf(github, "createComment")).toHaveLength(1);
        expect(appComments(github)).toHaveLength(1);
    });

    /**
     * GitHub said it applied the change and the read-back says it is not
     * there. Nothing may close on that: the row stays open so a later read
     * decides, rather than the journal recording a landing nobody saw.
     */
    it("will not close a call whose postcondition it could not see", async () => {
        const github = fakeGitHub();
        // Reported as applied, but the fake's world is left untouched.
        github.faults.scripted = [{ outcome: "applied" }];
        const effect = labelEffect({ meaning: "ready" });

        const outcome = one(await applierOver(github).applyAll([effect], configFor()));

        expect(outcome).toMatchObject({
            outcome: "unknown",
            code: "postconditionUnconfirmed",
            detail: "GitHub accepted the addLabel but the read-back answered notHeld",
        });
        expect(store.openIntents(FUTURE)).toHaveLength(1);
    });

    it("leaves the row open when GitHub itself could not say what happened", async () => {
        const github = fakeGitHub();
        github.faults.scripted = [{ outcome: "unknown", detail: "the connection dropped" }];
        const effect = labelEffect({ meaning: "ready" });

        const outcome = one(await applierOver(github).applyAll([effect], configFor()));

        expect(outcome).toMatchObject({
            outcome: "unknown",
            code: "writeUnknown",
            detail: "the connection dropped",
        });
        expect(store.openIntents(FUTURE)).toHaveLength(1);
    });

    it("closes an open row it cannot read, rather than resending from guesswork", async () => {
        const github = fakeGitHub();
        const effect = labelEffect({ meaning: "ready" });
        store.intent(keyOf(effect), 1, "not a row", BASE.toISOString(), "rev-1");

        const outcome = one(await applierOver(github).applyAll([effect], configFor()));

        expect(outcome).toMatchObject({ outcome: "refused", code: "rowUnreadable" });
        expect(github.calls).toEqual([]);
        expect(store.openIntents(FUTURE)).toEqual([]);
    });

    it("leaves the row open when the read-back cannot tell either way", async () => {
        const github = fakeGitHub();
        github.faults.crashOn = { verb: "createComment", when: "beforeSend" };
        const effect = commentEffect({ body: "hello" });
        await expect(applierOver(github).applyAll([effect], configFor())).rejects.toThrow();

        github.faults.crashOn = null;
        github.faults.presence = "unknown";
        const outcome = one(await applierOver(github).applyAll([effect], configFor()));

        expect(outcome).toMatchObject({ outcome: "unknown", code: "writeUnknown" });
        expect(store.openIntents(FUTURE)).toHaveLength(1);
        expect(appComments(github)).toEqual([]);
    });
});

// ─── Case 2: a worker that died, from a store reopened off disk ──────

/**
 * The store harness in `test/store/` forks a real worker, and it does not
 * transplant: it transpiles `store.ts` and its three dependencies by hand and
 * rewrites one import specifier, and the applier reaches core's whole barrel
 * plus this package. Reopening the same file is the honest substitute — a
 * second `Store` over the bytes the first one committed, which is what a
 * restarted process gets.
 */
describe("a worker that died holding an effect, seen by the process that replaces it", () => {
    it("finishes from the journal the dead worker left on disk", async () => {
        const github = fakeGitHub();
        github.faults.crashOn = { verb: "createComment", when: "afterSend" };
        const effect = commentEffect({ body: "hello" });

        await expect(applierOver(github).applyAll([effect], configFor())).rejects.toThrow(
            "crash after createComment",
        );
        store.close();

        const restarted = new Store(storePath);
        try {
            github.faults.crashOn = null;
            const outcome = one(
                await applierOver(github, { store: restarted, worker: "worker-2" }).applyAll(
                    [effect],
                    configFor(),
                ),
            );

            expect(outcome).toMatchObject({ outcome: "applied" });
            expect(callsOf(github, "createComment")).toHaveLength(1);
            expect(restarted.effectState(keyOf(effect), 1)).toMatchObject({ state: "complete" });
        } finally {
            restarted.close();
        }
        store = new Store(storePath);
    });
});

// ─── Case 3: the double post that cannot happen ──────────────────────

describe("a comment create whose answer was lost", () => {
    it("is never posted twice, however many times the delivery is retried", async () => {
        const github = fakeGitHub();
        github.faults.crashOn = { verb: "createComment", when: "afterSend" };
        const effect = commentEffect({ body: "hello" });
        await expect(applierOver(github).applyAll([effect], configFor())).rejects.toThrow();

        github.faults.crashOn = null;
        for (let retry = 0; retry < 3; retry += 1) {
            await applierOver(github).applyAll([effect], configFor());
        }

        expect(callsOf(github, "createComment")).toHaveLength(1);
        expect(appComments(github)).toHaveLength(1);
    });
});

// ─── Case 4, 9, 10: recovery ─────────────────────────────────────────

describe("recovering an effect nobody closed", () => {
    /** The row a crashed worker leaves, with no delivery left to re-drive it. */
    const orphan = (call: Parameters<typeof serializeCall>[0]["call"], attempts = 1): string => {
        const effectId = "orphan-effect";
        for (let attempt = 0; attempt < attempts; attempt += 1) {
            store.intent(
                effectId,
                1,
                serializeCall({ capability: "intake", item: ITEM, call }),
                BASE.toISOString(),
                "rev-1",
            );
        }
        return effectId;
    };

    const openRow = () => {
        const rows = store.openIntents(FUTURE);
        expect(rows).toHaveLength(1);
        return rows[0]!;
    };

    it("closes a call GitHub already has, without sending anything", async () => {
        const github = fakeGitHub({ labels: [READY_LABEL] });
        const effectId = orphan({ verb: "addLabel", label: READY_LABEL });

        await applierOver(github).recover(openRow(), configFor());

        expect(github.calls).toEqual([]);
        expect(store.openIntents(FUTURE)).toEqual([]);
        expect(logged).toEqual([{ event: "effectApplied", effectId, seq: 1 }]);
        expect(leaseIsFree(effectId)).toBe(true);
    });

    it("resends a call GitHub confirms it never had, exactly once", async () => {
        const github = fakeGitHub();
        orphan({ verb: "addLabel", label: READY_LABEL });

        await applierOver(github).recover(openRow(), configFor());

        expect(callsOf(github, "addLabel")).toEqual([`addLabel ${READY_LABEL}`]);
        expect(github.world.labels).toEqual([READY_LABEL]);
        expect(store.openIntents(FUTURE)).toEqual([]);
    });

    it("does not recover a call under a different configuration revision", async () => {
        const github = fakeGitHub();
        const effectId = orphan({ verb: "addLabel", label: READY_LABEL });

        await applierOver(github).recover(openRow(), configFor("active", "rev-2"));

        expect(github.calls).toEqual([]);
        expect(store.openIntents(FUTURE)).toEqual([]);
        expect(logged).toContainEqual(
            expect.objectContaining({
                event: "effectRefused",
                effectId,
                code: "configurationChanged",
            }),
        );
    });

    it("closes a landed call even when the configuration changed", async () => {
        const github = fakeGitHub({ labels: [READY_LABEL] });
        orphan({ verb: "addLabel", label: READY_LABEL });

        await applierOver(github).recover(openRow(), configFor("active", "rev-2"));

        expect(github.calls).toEqual([]);
        expect(store.openIntents(FUTURE)).toEqual([]);
    });

    it("keeps an unknown call open when the configuration changed", async () => {
        const github = fakeGitHub();
        github.faults.presence = "unknown";
        orphan({ verb: "addLabel", label: READY_LABEL });

        await applierOver(github).recover(openRow(), configFor("active", "rev-2"));

        expect(github.calls).toEqual([]);
        expect(store.openIntents(FUTURE)).toHaveLength(1);
    });

    it("leaves an unresolvable row exactly where it was, and says nothing", async () => {
        const github = fakeGitHub();
        github.faults.presence = "unknown";
        orphan({ verb: "addLabel", label: READY_LABEL });

        await applierOver(github).recover(openRow(), configFor());

        expect(github.calls).toEqual([]);
        expect(store.openIntents(FUTURE)).toHaveLength(1);
        expect(logged).toEqual([]);
    });

    it.each([
        ["the repository left active mode", configFor("dry-run"), "modeRecordsOnly"],
        ["the repository is disabled", configFor("disabled"), "modeDisabled"],
        ["the capability was turned off", configWithCapabilityOff(), "capabilityDisabled"],
    ])("closes the row for good when %s", async (_label, config, code) => {
        const github = fakeGitHub();
        const effectId = orphan({ verb: "addLabel", label: READY_LABEL });

        await applierOver(github).recover(openRow(), config);

        expect(github.calls).toEqual([]);
        expect(store.openIntents(FUTURE)).toEqual([]);
        expect(logged).toEqual([
            expect.objectContaining({ event: "effectRefused", effectId, seq: 1, code }),
        ]);
    });

    /**
     * The brakes are core's rules, so their PRECEDENCE is core's too: with the
     * repository disabled and the capability turned off at once, the code an
     * operator reads is the one a fresh decision would have reported.
     */
    it("names the same code core would when two brakes trip together", async () => {
        const github = fakeGitHub();
        orphan({ verb: "addLabel", label: READY_LABEL });
        const disabledAndOff = {
            ...configFor("disabled"),
            capabilities: { intake: { enabled: false, settings: {} } },
        };

        await applierOver(github).recover(openRow(), disabledAndOff);

        expect(logged).toEqual([
            expect.objectContaining({ event: "effectRefused", code: "capabilityDisabled" }),
        ]);
    });

    it("closes the row for good when a kill switch is active", async () => {
        const github = fakeGitHub();
        const effectId = orphan({ verb: "addLabel", label: READY_LABEL });

        await applierOver(github, {
            externals: () => stubbedExternals({ killSwitchActive: true }),
        }).recover(openRow(), configFor());

        expect(github.calls).toEqual([]);
        expect(store.openIntents(FUTURE)).toEqual([]);
        expect(logged).toEqual([
            expect.objectContaining({
                event: "effectRefused",
                effectId,
                code: "killSwitch",
                detail: "a kill switch is active",
            }),
        ]);
    });

    it("closes the row for good when the installation no longer grants the write", async () => {
        const github = fakeGitHub();
        orphan({ verb: "addLabel", label: READY_LABEL });

        await applierOver(github, {
            externals: () => stubbedExternals({ installationGrants: ["issues:read"] }),
        }).recover(openRow(), configFor());

        expect(store.openIntents(FUTURE)).toEqual([]);
        expect(logged).toEqual([
            expect.objectContaining({ event: "effectRefused", code: "permissionMissing" }),
        ]);
    });

    it("abandons a call that has been declared as many times as the cap allows", async () => {
        const github = fakeGitHub();
        const effectId = orphan({ verb: "addLabel", label: READY_LABEL }, EFFECT_ATTEMPT_CAP);
        expect(openRow().attempt).toBe(EFFECT_ATTEMPT_CAP);

        await applierOver(github).recover(openRow(), configFor());

        expect(github.calls).toEqual([]);
        expect(store.openIntents(FUTURE)).toEqual([]);
        expect(logged).toEqual([
            {
                event: "effectAbandoned",
                effectId,
                seq: 1,
                attempts: EFFECT_ATTEMPT_CAP,
            },
        ]);
    });

    it("still resends one attempt below the cap", async () => {
        const github = fakeGitHub();
        orphan({ verb: "addLabel", label: READY_LABEL }, EFFECT_ATTEMPT_CAP - 1);

        await applierOver(github).recover(openRow(), configFor());

        expect(callsOf(github, "addLabel")).toHaveLength(1);
        expect(logged).toEqual([expect.objectContaining({ event: "effectApplied" })]);
    });

    it("leaves the row open when the brakes themselves could not be read", async () => {
        const github = fakeGitHub();
        orphan({ verb: "addLabel", label: READY_LABEL });

        await applierOver(github, {
            externals: () => {
                throw new Error("live externals unavailable");
            },
        }).recover(openRow(), configFor());

        // Not a refusal: nothing said no, so the row is not closed.
        expect(github.calls).toEqual([]);
        expect(store.openIntents(FUTURE)).toHaveLength(1);
        expect(logged).toEqual([]);
    });

    it("closes a row whose bytes nobody can read, rather than retrying it forever", async () => {
        const github = fakeGitHub();
        store.intent("broken-effect", 1, "not a row", BASE.toISOString(), "rev-1");

        await applierOver(github).recover(openRow(), configFor());

        expect(store.openIntents(FUTURE)).toEqual([]);
        expect(logged).toEqual([
            expect.objectContaining({
                event: "effectRefused",
                effectId: "broken-effect",
                code: "rowUnreadable",
            }),
        ]);
    });

    it("leaves a row alone while another worker holds its lease", async () => {
        const github = fakeGitHub();
        const effectId = orphan({ verb: "addLabel", label: READY_LABEL });
        expect(store.claim(effectId, "other-worker", BASE.toISOString(), BASE.toISOString())).toBe(
            true,
        );

        await applierOver(github).recover(openRow(), configFor());

        expect(github.calls).toEqual([]);
        expect(store.openIntents(FUTURE)).toHaveLength(1);
        expect(logged).toEqual([]);
    });

    /** Case 10: a rate limit leaves the row open, and one sweep clears it. */
    it("turns a retryLater into exactly one resend", async () => {
        const github = fakeGitHub();
        github.faults.scripted = [{ outcome: "retryLater", detail: "secondary rate limit" }];
        const effect = labelEffect({ meaning: "ready" });

        const first = one(await applierOver(github).applyAll([effect], configFor()));
        expect(first).toMatchObject({ outcome: "retryLater", code: "writeRetryLater" });
        expect(github.world.labels).toEqual([]);
        expect(store.openIntents(FUTURE)).toHaveLength(1);

        await applierOver(github).recover(openRow(), configFor());

        expect(callsOf(github, "addLabel")).toHaveLength(2);
        expect(github.world.labels).toEqual([READY_LABEL]);
        expect(store.openIntents(FUTURE)).toEqual([]);
    });
});

// ─── Case 5, 11: the apply-time re-gate ──────────────────────────────

describe("re-gating at apply time", () => {
    it("refuses after a human closed the item in the gap, and journals nothing", async () => {
        const github = fakeGitHub();
        // Between decide() and here: someone closed the issue.
        github.world.closed = true;
        const effect = labelEffect({ meaning: "ready" });

        const outcome = one(await applierOver(github).applyAll([effect], configFor()));

        expect(outcome).toMatchObject({ outcome: "refused", code: "itemClosed" });
        expect(github.calls).toEqual([]);
        expect(store.effectState(keyOf(effect), 1)).toEqual({ state: "neverStarted" });
        expect(leaseIsFree(keyOf(effect))).toBe(true);
    });

    it("refuses when the claim the capability made no longer matches the item", async () => {
        // The capability claimed `awaitingTriage` was present; it is not.
        const github = fakeGitHub();
        const effect = labelEffect({ meaning: "ready", displacing: "awaitingTriage" });

        const outcome = one(await applierOver(github).applyAll([effect], configFor()));

        expect(outcome).toMatchObject({ outcome: "refused", code: "preconditionStale" });
        expect(github.calls).toEqual([]);
    });

    it("reads a pull request's own state, merge included", async () => {
        const pr = { kind: "pullRequest", number: 9 } as const;
        const open = fakeGitHub();
        const merged = fakeGitHub({ closed: true, merged: true });
        const secondStore = new Store(temp.file("merged.sqlite"));

        try {
            const applied = one(
                await applierOver(open).applyAll(
                    [labelEffect({ item: pr, meaning: "needsReview" })],
                    configFor(),
                ),
            );
            const refused = one(
                await applierOver(merged, { store: secondStore }).applyAll(
                    [labelEffect({ item: pr, meaning: "needsReview" })],
                    configFor(),
                ),
            );

            expect(applied).toMatchObject({ outcome: "applied" });
            expect(refused).toMatchObject({ outcome: "refused", code: "itemClosed" });
            expect(refused.detail).toContain("merged");
            expect(merged.calls).toEqual([]);
        } finally {
            secondStore.close();
        }
    });

    it("refuses a kill switch flipped between deciding and applying", async () => {
        const github = fakeGitHub();
        const effect = labelEffect({ meaning: "ready" });

        const outcome = one(
            await applierOver(github, {
                externals: () => stubbedExternals({ killSwitchActive: true }),
            }).applyAll([effect], configFor()),
        );

        expect(outcome).toMatchObject({ outcome: "refused", code: "killSwitch" });
        expect(github.calls).toEqual([]);
    });

    it("asks again for a retry rather than acting on an item it could not read", async () => {
        const github = fakeGitHub();
        github.faults.itemReadFails = true;
        const effect = labelEffect({ meaning: "ready" });

        const outcome = one(await applierOver(github).applyAll([effect], configFor()));

        expect(outcome).toMatchObject({ outcome: "retryLater", code: "itemUnreadable" });
        expect(github.calls).toEqual([]);
    });

    it("asks again for a retry when the externals seam could not be built", async () => {
        const github = fakeGitHub();
        const effect = labelEffect({ meaning: "ready" });

        const outcome = one(
            await applierOver(github, {
                externals: () => {
                    throw new Error("live externals unavailable");
                },
            }).applyAll([effect], configFor()),
        );

        expect(outcome).toMatchObject({ outcome: "retryLater", code: "externalsUnavailable" });
        expect(github.calls).toEqual([]);
    });

    it("treats an ordering lookup that threw as a conflict, not as an absence", async () => {
        const github = fakeGitHub();
        const effect = labelEffect({ meaning: "ready" });

        const outcome = one(
            await applierOver(github, {
                externals: () =>
                    stubbedExternals({
                        latestHumanChangeAt: () => {
                            throw new Error("the timeline read broke");
                        },
                    }),
            }).applyAll([effect], configFor()),
        );

        expect(outcome).toMatchObject({ outcome: "refused", code: "humanOrderingUnknown" });
        expect(github.calls).toEqual([]);
    });

    /**
     * Case 11. The seam is a FACTORY, and this is why: a source built once at
     * decision time answers with the instant that decision read, so the human
     * change below would be invisible to it. Both sources are driven here, so
     * the assertion is a difference rather than a hope.
     */
    it("sees a human change made after the decision, which a memoised source cannot", async () => {
        const humanChangedAt = new Date("2026-09-02T09:30:00.000Z");
        const decisionTimeOrdering: Date | null = null;
        const memoised: EffectExternalsSource = () =>
            stubbedExternals({ latestHumanChangeAt: () => decisionTimeOrdering });
        const perPass: EffectExternalsSource = () =>
            stubbedExternals({ latestHumanChangeAt: () => humanChangedAt });

        const stale = fakeGitHub();
        const staleOutcome = one(
            await applierOver(stale, { externals: memoised }).applyAll(
                [labelEffect({ meaning: "ready" })],
                configFor(),
            ),
        );
        expect(staleOutcome).toMatchObject({ outcome: "applied" });
        expect(stale.calls).toHaveLength(1);

        const fresh = fakeGitHub();
        const freshStore = new Store(temp.file("fresh.sqlite"));
        try {
            const freshOutcome = one(
                await applierOver(fresh, { externals: perPass, store: freshStore }).applyAll(
                    [labelEffect({ meaning: "ready" })],
                    configFor(),
                ),
            );

            expect(freshOutcome).toMatchObject({ outcome: "refused", code: "newerHumanChange" });
            expect(fresh.calls).toEqual([]);
        } finally {
            freshStore.close();
        }
    });
});

// ─── Case 6: the two-call label swap ─────────────────────────────────

describe("a label move that displaces the position the item held", () => {
    const swap = labelEffect({ meaning: "ready", displacing: "awaitingTriage" });

    it("adds before it removes, so the item is never left with no position", async () => {
        const github = fakeGitHub({ labels: [TRIAGE_LABEL] });

        const outcome = one(await applierOver(github).applyAll([swap], configFor()));

        expect(outcome).toMatchObject({ outcome: "applied" });
        expect(github.calls).toEqual([`addLabel ${READY_LABEL}`, `removeLabel ${TRIAGE_LABEL}`]);
        expect(github.world.labels).toEqual([READY_LABEL]);
        expect(store.effectState(keyOf(swap), 2)).toMatchObject({ state: "complete" });
    });

    /**
     * The journal state a crash between the two calls leaves: seq 1 done, seq
     * 2 never declared. The item is then in the intermediate state the plan
     * chose — two position labels, which projects as a conflict — and finishing
     * is what clears it. A full re-gate here could only answer
     * `preconditionStale`, which is why a resume passes the brakes instead.
     */
    it("resumes at the second call and sends only that one", async () => {
        const github = fakeGitHub({ labels: [TRIAGE_LABEL, READY_LABEL] });
        store.intent(
            keyOf(swap),
            1,
            serializeCall({
                capability: "intake",
                item: ITEM,
                call: { verb: "addLabel", label: READY_LABEL },
            }),
            BASE.toISOString(),
            "rev-1",
        );
        expect(store.done(keyOf(swap), 1, BASE.toISOString())).toBe(true);
        expect(store.effectState(keyOf(swap), 2)).toMatchObject({
            state: "midSequence",
            lastDoneSeq: 1,
        });

        const outcome = one(await applierOver(github).applyAll([swap], configFor()));

        expect(outcome).toMatchObject({ outcome: "applied" });
        expect(github.calls).toEqual([`removeLabel ${TRIAGE_LABEL}`]);
        expect(github.world.labels).toEqual([READY_LABEL]);
        expect(store.effectState(keyOf(swap), 2)).toMatchObject({ state: "complete" });
    });

    it("does not resume a partial plan under another configuration", async () => {
        const github = fakeGitHub({ labels: [TRIAGE_LABEL, READY_LABEL] });
        store.intent(keyOf(swap), 1, "{}", BASE.toISOString(), "rev-1");
        store.done(keyOf(swap), 1, BASE.toISOString());

        const outcome = one(
            await applierOver(github).applyAll([swap], configFor("active", "rev-2")),
        );

        expect(outcome).toMatchObject({ outcome: "refused", code: "configurationChanged" });
        expect(github.calls).toEqual([]);
    });

    it("stops a resume the operator has since braked, and sends nothing", async () => {
        const github = fakeGitHub({ labels: [TRIAGE_LABEL, READY_LABEL] });
        store.intent(keyOf(swap), 1, "{}", BASE.toISOString(), "rev-1");
        store.done(keyOf(swap), 1, BASE.toISOString());

        const outcome = one(
            await applierOver(github, {
                externals: () => stubbedExternals({ killSwitchActive: true }),
            }).applyAll([swap], configFor()),
        );

        expect(outcome).toMatchObject({ outcome: "refused", code: "killSwitch" });
        expect(github.calls).toEqual([]);
        expect(github.world.labels).toEqual([TRIAGE_LABEL, READY_LABEL]);
    });

    it("carries on to the second call after resolving an open first one", async () => {
        const github = fakeGitHub({ labels: [TRIAGE_LABEL] });
        github.faults.crashOn = { verb: "addLabel", when: "afterSend" };
        await expect(applierOver(github).applyAll([swap], configFor())).rejects.toThrow();
        expect(store.effectState(keyOf(swap), 2)).toMatchObject({ state: "sentUnknown", seq: 1 });

        github.faults.crashOn = null;
        const outcome = one(await applierOver(github).applyAll([swap], configFor()));

        expect(outcome).toMatchObject({ outcome: "applied" });
        expect(callsOf(github, "addLabel")).toHaveLength(1);
        expect(github.world.labels).toEqual([READY_LABEL]);
    });

    it("does not combine a landed old call with a new configuration plan", async () => {
        const github = fakeGitHub({ labels: [TRIAGE_LABEL] });
        github.faults.crashOn = { verb: "addLabel", when: "afterSend" };
        await expect(applierOver(github).applyAll([swap], configFor())).rejects.toThrow();

        github.faults.crashOn = null;
        const outcome = one(
            await applierOver(github).applyAll([swap], configFor("active", "rev-2")),
        );

        expect(outcome).toMatchObject({ outcome: "refused", code: "configurationChanged" });
        expect(github.calls).toEqual([`addLabel ${READY_LABEL}`]);
        expect(github.world.labels).toEqual([TRIAGE_LABEL, READY_LABEL]);
    });

    it("stops before the second call when the operator braked between the two", async () => {
        const github = fakeGitHub({ labels: [TRIAGE_LABEL] });
        github.faults.crashOn = { verb: "addLabel", when: "afterSend" };
        await expect(applierOver(github).applyAll([swap], configFor())).rejects.toThrow();

        github.faults.crashOn = null;
        const outcome = one(
            await applierOver(github, {
                externals: () => stubbedExternals({ killSwitchActive: true }),
            }).applyAll([swap], configFor()),
        );

        // The first call is closed — a read said it landed — and the second
        // never leaves, so the item stays in the intermediate a human can see.
        expect(outcome).toMatchObject({ outcome: "refused", code: "killSwitch" });
        expect(callsOf(github, "removeLabel")).toEqual([]);
        expect(github.world.labels).toEqual([TRIAGE_LABEL, READY_LABEL]);
        expect(store.openIntents(FUTURE)).toEqual([]);
    });

    it("stops the plan where GitHub refused it, and closes that call", async () => {
        const github = fakeGitHub({ labels: [TRIAGE_LABEL] });
        github.faults.scripted = [{ outcome: "conflict", detail: "the item changed underneath" }];

        const outcome = one(await applierOver(github).applyAll([swap], configFor()));

        expect(outcome).toMatchObject({
            outcome: "refused",
            code: "writeConflict",
            detail: "the item changed underneath",
        });
        expect(github.calls).toEqual([`addLabel ${READY_LABEL}`]);
        expect(store.openIntents(FUTURE)).toEqual([]);
    });
});

// ─── Case 7, 8: the managed comment already there ────────────────────

/**
 * D1, the capability study's first defect: a comment's identity is its ITEM
 * and its PURPOSE, and neither of those is the occasion that provoked it.
 *
 * The shape is prQuality's: one dashboard comment per pull request, rewritten
 * as the checks report. Two deliveries about the same pull request are two
 * occasions — two effect ids, two journal rows — and exactly one comment.
 */
describe("a second occasion of the same purpose on the same item", () => {
    const LATER = new Date(CAUSE_AT.getTime() + 60 * 60_000);

    it("finds the standing comment and updates it in place", async () => {
        const github = fakeGitHub();
        const first = commentEffect({ body: "2 checks failing" });
        const second = commentEffect({ body: "1 check failing", observedAt: LATER });

        await applierOver(github).applyAll([first], configFor());
        const outcome = one(await applierOver(github).applyAll([second], configFor()));

        expect(second.intent.idempotencyKey).not.toBe(first.intent.idempotencyKey);
        expect(outcome).toMatchObject({ outcome: "applied" });
        expect(callsOf(github, "createComment")).toHaveLength(1);
        expect(appComments(github)).toEqual([
            appComment(1, `${markerOf(second)}\n\n1 check failing`),
        ]);
    });

    it("answers `already` when the second occasion would say the same thing", async () => {
        const github = fakeGitHub();
        const first = commentEffect({ body: "every check passed" });
        const second = commentEffect({ body: "every check passed", observedAt: LATER });

        await applierOver(github).applyAll([first], configFor());
        const outcome = one(await applierOver(github).applyAll([second], configFor()));

        expect(outcome).toMatchObject({ outcome: "already" });
        expect(github.calls).toEqual([`createComment ${markerOf(first)}\n\nevery check passed`]);
        expect(appComments(github)).toHaveLength(1);
    });

    /**
     * The discriminator, and the reason `topic` exists: one purpose that may
     * legitimately stand more than once on an item — a warning per assignee,
     * each on its own clock and so its own occasion — is one comment per
     * topic. Without the topic these two would be one identity, and the
     * second would rewrite the first person's warning with the second's.
     */
    it("keeps one comment per topic when a purpose stands more than once", async () => {
        const github = fakeGitHub();
        const alice = commentEffect({ kind: "warning", topic: "alice", body: "alice, 30 days" });
        const bob = commentEffect({
            kind: "warning",
            topic: "bob",
            body: "bob, 14 days",
            observedAt: LATER,
        });

        await applierOver(github).applyAll([alice], configFor());
        await applierOver(github).applyAll([bob], configFor());

        expect(callsOf(github, "createComment")).toHaveLength(2);
        expect(appComments(github)).toEqual([
            appComment(1, `${markerOf(alice)}\n\nalice, 30 days`),
            appComment(2, `${markerOf(bob)}\n\nbob, 14 days`),
        ]);
    });
});

/**
 * The marker is a WIRE FORMAT, and a journal row outlives the deployment that
 * wrote it. A row whose body carries a schema this reader does not read names
 * an identity it cannot compute, so it recognises nothing — including the
 * comment that row already posted.
 */
describe("a journal row from a deployment before the schema bump", () => {
    const V1_BODY =
        '<!-- hiero-automation:{"schemaVersion":1,"capability":"intake","kind":"summary","effect":"0a70e62c14228dbe"} -->\n\nthe summary';

    it("claims no comment at all, and cannot confirm the one it posts", async () => {
        const github = fakeGitHub({ comments: [appComment(7, V1_BODY)] });
        store.intent(
            "an-old-effect",
            1,
            serializeCall({
                capability: "intake",
                item: ITEM,
                call: { verb: "postComment", kind: "summary", body: V1_BODY },
            }),
            BASE.toISOString(),
            "rev-1",
        );

        await applierOver(github).recover(store.openIntents(FUTURE)[0]!, configFor());

        // The v1 comment is left exactly as it stands — this reader has no
        // grounds to edit a comment it cannot prove is its own.
        expect(github.world.comments[0]).toEqual(appComment(7, V1_BODY));
        expect(github.calls).toEqual([`createComment ${V1_BODY}`]);
        // Nothing is logged and the row stays open: an unconfirmable call is
        // `unknown`, and the attempt cap is what eventually ends it (D42).
        expect(logged).toEqual([]);
        expect(store.openIntents(FUTURE)).toHaveLength(1);
    });
});

describe("a managed comment this effect may already own", () => {
    it("updates in place when the body differs — D12's one repair", async () => {
        const effect = commentEffect({ body: "the new summary" });
        const github = fakeGitHub({
            comments: [appComment(7, `${markerOf(effect)}\n\nthe old summary`)],
        });

        const outcome = one(await applierOver(github).applyAll([effect], configFor()));

        expect(outcome).toMatchObject({ outcome: "applied" });
        expect(github.calls).toEqual(["updateComment #7"]);
        expect(github.world.comments[0]!.body).toBe(`${markerOf(effect)}\n\nthe new summary`);
    });

    it("writes nothing at all when the body is already the one it would post", async () => {
        const effect = commentEffect({ body: "the same summary" });
        const github = fakeGitHub({
            comments: [appComment(7, `${markerOf(effect)}\n\nthe same summary`)],
        });

        const outcome = one(await applierOver(github).applyAll([effect], configFor()));

        expect(outcome).toMatchObject({ outcome: "already" });
        expect(github.calls).toEqual([]);
    });

    it("finishes an unresolved comment update when the old body remains", async () => {
        const effect = commentEffect({ body: "the App's words" });
        const github = fakeGitHub({
            comments: [appComment(7, `${markerOf(effect)}\n\na human rewrote this`)],
        });
        store.intent(
            keyOf(effect),
            1,
            serializeCall({
                capability: "intake",
                item: ITEM,
                call: {
                    verb: "postComment",
                    kind: "summary",
                    body: `${markerOf(effect)}\n\nthe App's words`,
                },
            }),
            BASE.toISOString(),
            "rev-1",
        );

        await applierOver(github).recover(store.openIntents(FUTURE)[0]!, configFor());

        expect(github.calls).toEqual(["updateComment #7"]);
        expect(github.world.comments[0]!.body).toBe(`${markerOf(effect)}\n\nthe App's words`);
        expect(logged).toEqual([expect.objectContaining({ event: "effectApplied" })]);
    });

    /** Case 8: a marker is evidence only under App authorship (D125). */
    it("never claims a comment carrying a copied marker under a person's name", async () => {
        const effect = commentEffect({ body: "the summary" });
        const github = fakeGitHub({
            comments: [copiedComment(9, `${markerOf(effect)}\n\npasted by a person`)],
        });

        const outcome = one(await applierOver(github).applyAll([effect], configFor()));

        expect(outcome).toMatchObject({ outcome: "applied" });
        expect(github.calls).toEqual([`createComment ${markerOf(effect)}\n\nthe summary`]);
        expect(github.world.comments[0]).toEqual(
            copiedComment(9, `${markerOf(effect)}\n\npasted by a person`),
        );
    });

    it("does not claim another effect's comment, marker and authorship notwithstanding", async () => {
        const mine = commentEffect({ body: "mine" });
        const other = commentEffect({ kind: "warning", body: "another purpose" });
        const github = fakeGitHub({
            comments: [appComment(3, `${markerOf(other)}\n\nanother purpose`)],
        });

        const outcome = one(await applierOver(github).applyAll([mine], configFor()));

        expect(outcome).toMatchObject({ outcome: "applied" });
        expect(callsOf(github, "createComment")).toHaveLength(1);
        expect(github.world.comments).toHaveLength(2);
    });

    it("waits rather than creating when its own comment turned up mid-question", async () => {
        const github = fakeGitHub();
        // The list read saw nothing; the confirming read saw it. Creating on
        // that would post the second copy the two reads exist to prevent.
        github.faults.presence = "present";

        const outcome = one(
            await applierOver(github).applyAll([commentEffect({ body: "hi" })], configFor()),
        );

        expect(outcome).toMatchObject({ outcome: "retryLater", code: "writeRetryLater" });
        expect(outcome.detail).toContain("appeared between two reads");
        expect(github.calls).toEqual([]);
    });

    it("asks again for a retry when the comment list could not be read", async () => {
        const github = fakeGitHub();
        github.faults.commentReadFails = true;

        const outcome = one(
            await applierOver(github).applyAll([commentEffect({ body: "hi" })], configFor()),
        );

        expect(outcome).toMatchObject({ outcome: "retryLater", code: "writeRetryLater" });
        expect(callsOf(github, "createComment")).toEqual([]);
    });

    it("will not create while absence is unproven — the duplicate 6.5 measured", async () => {
        const github = fakeGitHub();
        github.faults.presence = "unknown";

        const outcome = one(
            await applierOver(github).applyAll([commentEffect({ body: "hi" })], configFor()),
        );

        expect(outcome).toMatchObject({ outcome: "retryLater", code: "writeRetryLater" });
        expect(callsOf(github, "createComment")).toEqual([]);
    });
});

// ─── An operation no endpoint realises ───────────────────────────────

describe("an operation the write surface does not have", () => {
    it.each([
        ["unassign", "no confirmed write endpoint unassigns"],
        ["assign", "no confirmed write endpoint assigns"],
    ] as const)(
        "%s is refused where every call is sent, and its row is closed",
        async (operation, said) => {
            const github = fakeGitHub();
            const effect = labelEffect();
            const asked = {
                ...effect,
                intent: { ...effect.intent, operation, desired: { login: "sophie" } },
            } as unknown as typeof effect;

            const outcome = one(await applierOver(github).applyAll([asked], configFor()));

            expect(outcome).toMatchObject({ outcome: "refused", code: "writeForbidden" });
            expect(outcome.detail).toContain(said);
            expect(github.calls).toEqual([]);
            expect(store.openIntents(FUTURE)).toEqual([]);
        },
    );

    /**
     * The two moderation verbs are refused the same way, and the sentence
     * names the endpoint that is missing rather than the operation that
     * failed — an operator reading the report has to know which row of
     * `endpoint-permission-matrix.md` would unblock it.
     */
    it.each([
        ["lockIssue", "no confirmed write endpoint locks an issue"],
        ["unlockIssue", "no confirmed write endpoint unlocks an issue"],
    ])(
        "refuses a %s at the send, naming the endpoint nobody confirmed",
        async (operation, said) => {
            const github = fakeGitHub();
            const effect = labelEffect();
            const moderation = {
                ...effect,
                intent: { ...effect.intent, operation, desired: { reason: "triage" } },
            } as unknown as typeof effect;

            const outcome = one(await applierOver(github).applyAll([moderation], configFor()));

            expect(outcome).toMatchObject({ outcome: "refused", code: "writeForbidden" });
            expect(outcome.detail).toContain(said);
            expect(github.calls).toEqual([]);
            expect(store.openIntents(FUTURE)).toEqual([]);
        },
    );

    /**
     * Recovery reads a row back before it looks at the verb, so a row naming
     * an unassign reaches the proof step — where nothing reads an assignee
     * list, so nothing can prove one. The row stays open rather than being
     * closed on a fact nobody established.
     */
    it.each([
        ["assign", { verb: "assign", login: "sophie" }],
        ["lockIssue", { verb: "lockIssue", reason: "triage" }],
        ["unlockIssue", { verb: "unlockIssue", reason: "approved" }],
    ])("cannot prove a %s either, so its row stays open", async (name, call) => {
        const github = fakeGitHub();
        store.intent(
            `${name}-effect`,
            1,
            serializeCall({ capability: "intake", item: ITEM, call: call as never }),
            BASE.toISOString(),
            "rev-1",
        );

        await applierOver(github).recover(store.openIntents(FUTURE)[0]!, configFor());

        expect(github.calls).toEqual([]);
        expect(store.openIntents(FUTURE)).toHaveLength(1);
    });

    it("cannot prove an unassign, so recovery leaves its row where it was", async () => {
        const github = fakeGitHub();
        store.intent(
            "unassign-effect",
            1,
            serializeCall({
                capability: "intake",
                item: ITEM,
                call: { verb: "unassign", login: "sophie" },
            }),
            BASE.toISOString(),
            "rev-1",
        );

        await applierOver(github).recover(store.openIntents(FUTURE)[0]!, configFor());

        expect(github.calls).toEqual([]);
        expect(store.openIntents(FUTURE)).toHaveLength(1);
        expect(logged).toEqual([]);
    });
});

// ─── Case 12: the lease ──────────────────────────────────────────────

describe("the effect lease", () => {
    const effect = labelEffect({ meaning: "ready" });

    it("is never taken from a live worker inside the window", async () => {
        const github = fakeGitHub();
        const heldAt = new Date(BASE.getTime() - (EFFECT_LEASE_STALE_MINUTES - 1) * 60_000);
        expect(
            store.claim(keyOf(effect), "other-worker", heldAt.toISOString(), heldAt.toISOString()),
        ).toBe(true);

        const outcome = one(await applierOver(github).applyAll([effect], configFor()));

        expect(outcome).toMatchObject({
            outcome: "unknown",
            code: "leaseHeld",
            detail: "a live worker holds this effect's lease",
        });
        expect(github.calls).toEqual([]);
        expect(store.effectState(keyOf(effect), 1)).toEqual({ state: "neverStarted" });
    });

    it("is taken over once the holder is a full window stale", async () => {
        const github = fakeGitHub();
        const heldAt = new Date(BASE.getTime() - (EFFECT_LEASE_STALE_MINUTES + 1) * 60_000);
        store.claim(keyOf(effect), "other-worker", heldAt.toISOString(), heldAt.toISOString());

        const outcome = one(await applierOver(github).applyAll([effect], configFor()));

        expect(outcome).toMatchObject({ outcome: "applied" });
        expect(github.calls).toHaveLength(1);
    });

    it.each([
        [
            "a refusal",
            (github: FakeGitHub) => {
                github.world.closed = true;
            },
        ],
        [
            "a write GitHub refused",
            (github: FakeGitHub) => {
                github.faults.scripted.push({ outcome: "forbidden", detail: "denied" });
            },
        ],
        ["a clean apply", () => undefined],
    ])("is released after %s", async (_label, arrange) => {
        const github = fakeGitHub();
        arrange(github);

        await applierOver(github).applyAll([effect], configFor());

        expect(leaseIsFree(keyOf(effect))).toBe(true);
    });

    it("is released even when a seam threw and the pass never finished", async () => {
        const github = fakeGitHub();
        github.faults.crashOn = { verb: "addLabel", when: "beforeSend" };

        await expect(applierOver(github).applyAll([effect], configFor())).rejects.toThrow();

        expect(leaseIsFree(keyOf(effect))).toBe(true);
    });

    it("does not release a lease this pass never held", async () => {
        const github = fakeGitHub();
        const heldAt = new Date(BASE.getTime() - (EFFECT_LEASE_STALE_MINUTES - 1) * 60_000);
        store.claim(keyOf(effect), "other-worker", heldAt.toISOString(), heldAt.toISOString());

        await applierOver(github).applyAll([effect], configFor());

        // Still the other worker's: a refused claim must not hand its lease
        // away, which a `release` outside the claim's own branch would do.
        expect(store.release(keyOf(effect), "other-worker")).toBe(true);
    });
});

/**
 * The moment a promise becomes a record (grace.md §3): the applier writes the
 * warning down only once GitHub says the comment is there, so a warning that
 * never posted authorizes nothing — because nothing recorded it.
 */
describe("a warning effect's comment, once it lands", () => {
    it("records the ACT's authority, dated at the moment the comment appeared", async () => {
        const github = fakeGitHub();
        const effect = warningEffect();

        const outcome = one(await applierOver(github).applyAll([effect], configFor()));

        expect(outcome).toMatchObject({ outcome: "applied", operation: "postManagedComment" });
        // Keyed by the ACT, not by the comment that published it.
        expect(store.warning(effect.intent.idempotencyKey)).toBeNull();
        expect(store.warning(ACT_EFFECT_ID)).toEqual({
            effectId: ACT_EFFECT_ID,
            warnedAt: BASE.toISOString(),
            gracePeriodDays: 7,
            earliestActionAt: new Date(BASE.getTime() + 7 * 24 * 60 * 60_000).toISOString(),
            cancelledBy: "a commit or a /working comment",
            reversesWith: "re-assign / reopen",
            actionClass: "clockTriggeredDestructive",
            capability: "intake",
            causeObservedAt: "2026-09-02T09:00:00.000Z",
            cause: "issue opened",
            item: "hiero-hackers/sdk-automations#164",
            change: "release alice",
        });
    });

    /**
     * A resend that finds the comment already there is still a warning that
     * stands, so the record is written on `already` too — one row either way,
     * because the promise is one promise.
     */
    it("records on `already` as well, and keeps one row", async () => {
        const github = fakeGitHub();
        const effect = warningEffect();
        await applierOver(github).applyAll([effect], configFor());

        // A second decision, a second pass: the journal is cleared so the
        // effect is fresh again, and GitHub already holds the comment.
        store.pruneDoneJournal(FUTURE);
        const outcome = one(await applierOver(github).applyAll([effect], configFor()));

        expect(outcome).toMatchObject({ outcome: "already" });
        expect(store.warning(ACT_EFFECT_ID)).toMatchObject({ warnedAt: BASE.toISOString() });
    });

    /** An effect that records nothing writes nothing — every other effect. */
    it("writes no warning for an effect that carries none", async () => {
        const github = fakeGitHub();
        const effect = commentEffect({ kind: "warning" });

        await applierOver(github).applyAll([effect], configFor());

        expect(store.warning(effect.intent.idempotencyKey)).toBeNull();
        expect(store.warning(ACT_EFFECT_ID)).toBeNull();
    });

    /** A refused send is not a promise, so there is nothing to remember. */
    it("records nothing when the comment never posted", async () => {
        const github = fakeGitHub();
        github.faults.scripted = [{ outcome: "forbidden", detail: "no" }];

        const outcome = one(await applierOver(github).applyAll([warningEffect()], configFor()));

        expect(outcome).toMatchObject({ outcome: "refused", code: "writeForbidden" });
        expect(store.warning(ACT_EFFECT_ID)).toBeNull();
    });
});

/**
 * The apply-time re-gate takes the door the decision took (grace.md §2), so an
 * approval to release is permission to release NOW: the record is read again
 * here, and a grace still running refuses the act however long ago it was
 * approved.
 */
describe("a graced act at the apply-time re-gate", () => {
    /** A day, and the two instants these rows read the promise from. */
    const DAY = 24 * 60 * 60_000;
    const later = (days: number) => new Date(BASE.getTime() + days * DAY);

    /**
     * The record the warning comment would have written. `BASE` is after the
     * intent's own causal observation, which is what the door requires of any
     * warning: one that predates its observation is not a promise about it.
     */
    const recordWarning = (): void => {
        store.recordWarning({
            effectId: ACT_EFFECT_ID,
            warnedAt: BASE.toISOString(),
            gracePeriodDays: 7,
            earliestActionAt: later(7).toISOString(),
            cancelledBy: "a commit or a /working comment",
            reversesWith: "re-assign / reopen",
            actionClass: "clockTriggeredDestructive",
            capability: "intake",
            causeObservedAt: "2026-09-02T09:00:00.000Z",
            cause: "issue opened",
            item: "hiero-hackers/sdk-automations#164",
            change: "release alice",
        });
    };

    const applyAt = async (at: Date, effect = releaseEffect(), github = fakeGitHub()) => ({
        github,
        outcome: one(
            await applierOver(github, { clock: () => at }).applyAll([effect], configFor()),
        ),
    });

    it("refuses with `noWarning` when the record is gone by the time it applies", async () => {
        const { outcome, github } = await applyAt(later(8));

        expect(outcome).toMatchObject({ outcome: "refused", code: "noWarning" });
        expect(github.calls).toEqual([]);
    });

    it("refuses with `graceRunning` while the promise still has time left", async () => {
        recordWarning();

        const { outcome, github } = await applyAt(later(2));

        expect(outcome).toMatchObject({ outcome: "refused", code: "graceRunning" });
        expect(github.calls).toEqual([]);
    });

    /**
     * The general door would have refused this `wrongEntryPoint` — a defect
     * code — rather than letting the send answer. Past the destructive gates
     * the plan runs, and it stops at the release: no confirmed write endpoint
     * performs one, so the notice never claims a release that did not land.
     */
    it("reaches the send once the grace has run, and stops before the notice", async () => {
        recordWarning();

        const { outcome, github } = await applyAt(later(8));

        expect(outcome).toMatchObject({ outcome: "refused", code: "writeForbidden" });
        expect(github.world.comments).toEqual([]);
    });

    it("refuses when the person acted after they were warned", async () => {
        recordWarning();
        const effect = releaseEffect();
        const active = {
            ...effect,
            intent: {
                ...effect.intent,
                grace: { ...effect.intent.grace!, activityAt: later(3) },
            },
        } as typeof effect;

        const { outcome, github } = await applyAt(later(8), active);

        expect(outcome).toMatchObject({ outcome: "refused", code: "activityCancelled" });
        expect(github.calls).toEqual([]);
    });
});
