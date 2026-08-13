/**
 * The recovery-loop executor — `design/operations/storage-decision.md`
 * §"The recovery loop the grid decided" as code: the journal knows WHAT
 * to check, GitHub (behind `EffectPort`) knows HOW IT ENDED, and the
 * call's declared idempotency class decides how a retry must happen.
 *
 * GitHub never appears here: `EffectPort` is the only exit, so the
 * crash-grid harness can drive the engine through every failure the
 * 6.5 sandbox produced by hand — and every interleaving it didn't.
 *
 * `commands.ts` owns what crosses to an adapter, `policy.ts` the numbers
 * this loop runs on, `planner.ts` how a plan comes to exist. This file
 * owns only what happens to one plan once it does.
 */

import { Store } from "@hiero-hackers/automation-store";
import { LEASE_MS } from "./policy.js";
import type { AdapterCommand, EffectPlan, EffectPort } from "./commands.js";

export type RunResult =
    | { readonly outcome: "complete" }
    | { readonly outcome: "anotherWorker" }
    | {
          readonly outcome: "unresolved";
          readonly seq: number;
          readonly reason: string;
      };

/**
 * A call re-sent this many times stops being a retry problem and
 * surfaces to the operator instead (D44). The count read is the
 * journal's durable one, so the bound survives a restart.
 * FINDING(executor-attempt-bound).
 */
export const MAX_CALL_ATTEMPTS = 5;

/**
 * Canonical journal identity for a command. The ordered tuple is independent
 * of object-key insertion order and JSON escapes every field boundary.
 * The command schema has no credential or client fields.
 */
export function commandIdentity(command: AdapterCommand): string {
    const common = [
        command.repository.owner,
        command.repository.repo,
        command.item.kind,
        command.item.number,
        command.configurationRevision,
        [...command.expected.meaningsPresent],
        [...command.expected.meaningsAbsent],
        command.expected.closed,
        command.configuredLabels.map(({ meaning, label }) => [meaning, label]),
    ] as const;

    switch (command.operation) {
        case "postManagedComment":
            return JSON.stringify([
                command.operation,
                common,
                command.desired.marker,
                command.desired.body,
                command.readBack.kind,
            ]);
        case "applyMappedLabel":
            return JSON.stringify([
                command.operation,
                common,
                command.desired.meaning,
                command.desired.label,
                command.readBack.kind,
            ]);
        case "unassign":
            return JSON.stringify([
                command.operation,
                common,
                command.desired.login,
                command.readBack.kind,
            ]);
    }
}

function unsupportedEffectState(state: never): never {
    throw new TypeError(`unsupported effect state ${JSON.stringify(state)}`);
}

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
    async runEffect(plan: EffectPlan): Promise<RunResult> {
        plan.calls.forEach((call, i) => {
            if (call.seq !== i + 1) {
                throw new TypeError(
                    `plan "${plan.effectId}" calls must be contiguous from 1; call ${String(i)} has seq ${String(call.seq)}`,
                );
            }
            if (call.command.configurationRevision !== plan.revision) {
                throw new TypeError(
                    `plan "${plan.effectId}" revision does not match call ${String(call.seq)} configuration revision`,
                );
            }
        });
        const now = this.now();
        const staleBefore = new Date(Date.parse(now) - this.leaseMs).toISOString();
        if (!this.store.claim(plan.effectId, this.worker, now, staleBefore)) {
            return { outcome: "anotherWorker" };
        }
        const result = await this.drive(plan);
        this.store.release(plan.effectId, this.worker);
        return result;
    }

    /** The storage-decision flowchart, one branch per journal answer. */
    private async drive(plan: EffectPlan): Promise<RunResult> {
        const planLength = plan.calls.length;
        const state = this.store.effectState(plan.effectId, planLength);
        /**
         * A revision mismatch only matters for an effect still IN FLIGHT.
         * `manual-edits.md` §9 invalidates intents that would resume under
         * a new revision, and a finished effect has nothing to resume.
         * Guarding `complete` too would surface every redelivery of a
         * finished effect as unresolved after any configuration edit —
         * manufactured operator work, not a safety property (D43, D45).
         * The revision an effect ran under is history, not a conflict.
         */
        if (
            (state.state === "sentUnknown" || state.state === "midSequence") &&
            state.revision !== plan.revision
        ) {
            return {
                outcome: "unresolved",
                seq: state.state === "sentUnknown" ? state.seq : state.lastDoneSeq,
                reason: "journaled effect revision does not match the current default-branch configuration revision",
            };
        }
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
                 * A journal row whose seq or intent no longer matches the
                 * plan means the plan changed under an open effect. The
                 * engine stops and surfaces; it never guesses a mapping
                 * between an old plan and a new one (D45).
                 * FINDING(executor-stale-plan).
                 */
                if (call === undefined || commandIdentity(call.command) !== state.intent) {
                    return {
                        outcome: "unresolved",
                        seq: state.seq,
                        reason: "open journal row does not match the current plan — intents from an old revision are not resumable (manual-edits.md §9)",
                    };
                }
                // Journal detects; GitHub resolves.
                if ((await this.port.readBack(plan, call)) === "present") {
                    this.store.done(plan.effectId, state.seq, this.now());
                    startSeq = state.seq + 1;
                } else {
                    if (state.attempt >= MAX_CALL_ATTEMPTS) {
                        return {
                            outcome: "unresolved",
                            seq: state.seq,
                            reason: `call re-sent ${String(state.attempt)} times and remains absent — surfacing instead of retrying (FINDING(executor-attempt-bound))`,
                        };
                    }
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
            default:
                return unsupportedEffectState(state);
        }
        for (let seq = startSeq; seq <= planLength; seq++) {
            const call = plan.calls[seq - 1]!;
            this.store.intent(
                plan.effectId,
                seq,
                commandIdentity(call.command),
                this.now(),
                plan.revision,
            );
            await this.port.perform(plan, call); // a throw here IS the crash
            this.store.done(plan.effectId, seq, this.now());
        }
        return { outcome: "complete" };
    }
}
