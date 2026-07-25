/**
 * The recovery-loop executor — `design/operations/storage-decision.md`
 * §"The recovery loop the grid decided" as code: the journal knows WHAT
 * to check, GitHub (behind `EffectPort`) knows HOW IT ENDED, and the
 * call's declared idempotency class decides how a retry must happen.
 *
 * GitHub never appears here: `EffectPort` is the only exit, so the
 * crash-grid harness can drive the engine through every failure the
 * 6.5 sandbox produced by hand — and every interleaving it didn't.
 */

import type { IdempotencyClass } from "@hiero-hackers/automation-core";
import { Store } from "@hiero-hackers/automation-store";
import { LEASE_MS } from "./policy.js";

export interface PlannedCall {
    /** 1-based, contiguous — the journal's call_seq. */
    readonly seq: number;
    readonly intent: string;
    readonly idempotencyClass: IdempotencyClass;
}

export interface EffectPlan {
    readonly effectId: string;
    readonly calls: readonly PlannedCall[];
}

/**
 * The engine's only exits to the world. `perform` may throw — a throw
 * models the process dying mid-call (response lost); the engine never
 * catches it, exactly as a real crash never lets it. `readBack` is the
 * resolver: did this call's effect land? It must answer from GitHub
 * state (for non-idempotent calls, the managed-comment marker — D13).
 *
 * FINDING(executor-readback-consistency), D46: the loop's exactly-once
 * guarantee is PROVEN ONLY RELATIVE TO A CONSISTENT READ-BACK. A stale
 * "absent" right after a landed write makes the loop duplicate despite
 * following every rule — real GitHub reads can lag writes. The port
 * implementation owes a confirmed-fresh read (or bounded delay and
 * re-read) before answering "absent"; measuring that staleness is
 * stage-five sandbox work.
 */
export interface EffectPort {
    perform(plan: EffectPlan, call: PlannedCall): void;
    readBack(plan: EffectPlan, call: PlannedCall): "present" | "absent";
}

export type RunResult =
    | { readonly outcome: "complete" }
    | { readonly outcome: "anotherWorker" }
    | {
          readonly outcome: "unresolved";
          readonly seq: number;
          readonly reason: string;
      };

/**
 * FINDING(executor-attempt-bound): the storage decision requires
 * "retries with bounded history" but names no bound — the same
 * unnamed-floor pattern as safety.md's grace period (D30). Encoded so
 * the question cannot be silently skipped: a call re-sent this many
 * times stops being a retry problem and surfaces to the operator.
 */
export const MAX_CALL_ATTEMPTS = 5;

export class RecoveryExecutor {
    constructor(
        private readonly store: Store,
        private readonly port: EffectPort,
        private readonly worker: string,
        /** Caller-supplied clock, canonical `Date.toISOString()` form. */
        private readonly now: () => string,
        private readonly leaseMs: number = LEASE_MS,
    ) {}

    /**
     * Claim, drive to completion (or a surfaced stop), release. A
     * throw from `perform` propagates WITHOUT releasing the claim —
     * that is the crash model: a dead process releases nothing, and
     * D41's lease takeover is what unblocks the effect afterwards.
     */
    runEffect(plan: EffectPlan): RunResult {
        plan.calls.forEach((call, i) => {
            if (call.seq !== i + 1) {
                throw new TypeError(
                    `plan "${plan.effectId}" calls must be contiguous from 1; call ${String(i)} has seq ${String(call.seq)}`,
                );
            }
        });
        const now = this.now();
        const staleBefore = new Date(Date.parse(now) - this.leaseMs).toISOString();
        if (!this.store.claim(plan.effectId, this.worker, now, staleBefore)) {
            return { outcome: "anotherWorker" };
        }
        const result = this.drive(plan);
        this.store.release(plan.effectId, this.worker);
        return result;
    }

    /** The storage-decision flowchart, one branch per journal answer. */
    private drive(plan: EffectPlan): RunResult {
        const planLength = plan.calls.length;
        const state = this.store.effectState(plan.effectId, planLength);
        let startSeq: number;
        switch (state.state) {
            case "complete":
                return { outcome: "complete" };
            case "neverStarted":
                startSeq = 1;
                break;
            case "midSequence":
                startSeq = state.lastDoneSeq + 1;
                break;
            case "sentUnknown": {
                const call = plan.calls[state.seq - 1];
                /**
                 * FINDING(executor-stale-plan): a journal row whose seq
                 * or intent no longer matches the plan means the plan
                 * changed under an open effect (configuration revision,
                 * capability update). manual-edits.md §9 rules intents
                 * from an old revision invalid — so the engine stops
                 * and surfaces; it never guesses a mapping between old
                 * and new plans.
                 */
                if (call === undefined || call.intent !== state.intent) {
                    return {
                        outcome: "unresolved",
                        seq: state.seq,
                        reason: "open journal row does not match the current plan — intents from an old revision are not resumable (manual-edits.md §9)",
                    };
                }
                if (state.attempt >= MAX_CALL_ATTEMPTS) {
                    return {
                        outcome: "unresolved",
                        seq: state.seq,
                        reason: `call re-sent ${String(state.attempt)} times without a confirmed outcome — surfacing instead of retrying (FINDING(executor-attempt-bound))`,
                    };
                }
                // Journal detects; GitHub resolves.
                if (this.port.readBack(plan, call) === "present") {
                    this.store.done(plan.effectId, state.seq);
                    startSeq = state.seq + 1;
                } else {
                    // Absent. The read-back that just happened is what
                    // makes re-sending safe for BOTH classes — a blind
                    // retry of a nonIdempotent call is the demonstrated
                    // duplication failure (6.5). Re-enter at this seq;
                    // the re-declared intent increments the durable
                    // attempt counter (D42).
                    startSeq = state.seq;
                }
                break;
            }
        }
        for (let seq = startSeq; seq <= planLength; seq++) {
            const call = plan.calls[seq - 1]!;
            this.store.intent(plan.effectId, seq, call.intent, this.now());
            this.port.perform(plan, call); // a throw here IS the crash
            this.store.done(plan.effectId, seq);
        }
        return { outcome: "complete" };
    }
}
