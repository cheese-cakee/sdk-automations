/**
 * How one approved effect becomes a landed GitHub change, exactly once — stage C.
 * `effects.ts` says what an effect's calls ARE and `operations/` what each one plans
 * and sends; this file is the choreography around them, and it knows no verb. Two
 * rules run through all of it: nothing is sent that was not journalled first, and
 * nothing is closed that was not read back.
 */

import {
    deriveWorld,
    evaluateDestructive,
    evaluateStandingRules,
    evaluateWrite,
    INTENT_OPERATIONS,
    writeRequestFor,
    matchesManagedComment,
    meaningsOfLabels,
    parseManagedMarker,
    projectIssue,
    projectPullRequest,
    type AnyIntent,
    type Effect,
    type HumanChangeOrdering,
    type IntentOperation,
    type ItemRef,
    type MappableMeaning,
    type ObservedModes,
    type Projection,
    type RepositoryConfig,
    type WarningToRecord,
} from "@hiero-hackers/automation-core";
import type { OpenIntent, Store } from "../store/index.js";
import type { Call, EffectOutcome, EffectOutcomeCode, EffectOutcomeName } from "./effects.js";
import { recordedWarningsIn, type ShellExternals } from "./externals.js";
import { detailOf, type Log } from "./log.js";
import type {
    CommentSeen,
    Confirmation,
    EffectReader,
    EffectWriter,
    ItemSeen,
    ReadAnswer,
    SendContext,
    WriteResult,
} from "./operations/handler.js";
import {
    confirmCall,
    operationOf,
    parseJournaledCall,
    planFor,
    sendCall,
    serializeCall,
} from "./operations/index.js";

/** The seam vocabulary, re-exported from its new home to keep the barrel's name set. */
export type {
    CommentSeen,
    EffectReader,
    EffectWriter,
    ItemSeen,
    ReadAnswer,
    SeenState,
    WriteResult,
} from "./operations/handler.js";

// ─── The chosen bounds ───────────────────────────────────────────────

/**
 * How long an effect lease is honoured before a later worker may take it over.
 * Not a proof GitHub stopped processing a timed-out request; live takeover stays open (D41).
 */
export const EFFECT_LEASE_STALE_MINUTES = 10;

/**
 * How many times one call may be declared before recovery gives up on it.
 * The journal's `attempt` column counts durably, so this bounds the effect, not a process (D42).
 */
export const EFFECT_ATTEMPT_CAP = 5;

// ─── The seams ───────────────────────────────────────────────────────

/**
 * A FRESH externals set, built per apply pass.
 * Never the delivery's own: its memo would answer the apply-time gate with the instant the DECISION read, which is the one thing a re-gate must not believe.
 */
export type EffectExternalsSource = () => ShellExternals | Promise<ShellExternals>;

export interface ApplierOptions {
    readonly store: Store;
    readonly writer: EffectWriter;
    readonly reader: EffectReader;
    readonly externals: EffectExternalsSource;
    /** Which worker holds a lease; the store releases only this name's own. */
    readonly worker: string;
    readonly clock: () => Date;
    /** Recovery has no delivery to report into, so its lines leave here. */
    readonly log: Log;
}

/** The write path, as the processor and the sweep each use it. */
export interface Applier {
    /** Every approved effect of one decision, in order, each under its own lease. */
    applyAll(
        effects: readonly Effect[],
        config: RepositoryConfig,
    ): Promise<readonly EffectOutcome[]>;
    /** One open journal row, resolved against GitHub — the sweep's unit of work. */
    recover(open: OpenIntent, config: RepositoryConfig): Promise<void>;
}

// ─── What a pass is working on ───────────────────────────────────────

/** Everything one pass over one effect shares. */
interface Pass {
    readonly effectId: string;
    readonly capability: string;
    readonly item: ItemRef;
    readonly config: RepositoryConfig;
    /** The warning this comment records when it lands; `null` for every recovery pass. */
    readonly records: WarningToRecord | null;
}

/** What a pass concluded, before it is dressed as an `EffectOutcome`. */
interface PassResult {
    readonly outcome: EffectOutcomeName;
    readonly code: EffectOutcomeCode | null;
    readonly detail: string | null;
}

/** One call either landed, or ended the pass. */
type CallResult =
    | { readonly kind: "done"; readonly changed: boolean }
    | { readonly kind: "stop"; readonly result: PassResult };

/** A gate passed, or the result its refusal produces. */
type GateVerdict = { readonly ok: true } | { readonly ok: false; readonly result: PassResult };

const stop = (
    outcome: EffectOutcomeName,
    code: EffectOutcomeCode | null,
    detail: string,
): CallResult => ({ kind: "stop", result: { outcome, code, detail } });

const refuse = (code: EffectOutcomeCode, detail: string): GateVerdict => ({
    ok: false,
    result: { outcome: "refused", code, detail },
});

/**
 * The live item as a projection.
 * A merged pull request is `merged` and everything else closed is `closedByHuman`; every closure refuses the write by the same rule, so the choice cannot change a verdict.
 */
function projectionFrom(
    seen: ItemSeen,
    kind: ItemRef["kind"],
    config: RepositoryConfig,
): Projection<MappableMeaning> {
    const observation = {
        closedBy: seen.closed
            ? seen.merged
                ? ("merged" as const)
                : ("closedByHuman" as const)
            : null,
        meanings: meaningsOfLabels(config, seen.labels),
    };
    return kind === "issue" ? projectIssue(observation) : projectPullRequest(observation);
}

/**
 * Is this comment the one the call about to be sent would BE? Authorship and identity (D125).
 * The identity comes from the call's own rendered body, which is all a resend has, so a recovery pass and a fresh one ask exactly the same question (D145).
 */
const isMine = (body: string): ((comment: CommentSeen) => boolean) => {
    const published = parseManagedMarker(body);
    const mine = "recognized" in published ? published.recognized : null;
    return (comment: CommentSeen): boolean =>
        mine !== null &&
        matchesManagedComment({ body: comment.body, authoredByApp: comment.authoredByApp }, mine)
            .matches;
};

export function createApplier(options: ApplierOptions): Applier {
    const { store, writer, reader, externals, worker, clock, log } = options;

    const now = (): string => clock().toISOString();

    /**
     * The recorded warning, read from the SAME store the applier journals in.
     * Not through `externals`: a warning is the platform's own record, so the credential-free path can still gate its own destructive acts (grace.md §2).
     */
    const warningFor = recordedWarningsIn(store);

    /**
     * Did the affected person act after they were warned?
     * The instant is the DECISION's reading; this narrows rather than carries the claim.
     */
    const activityCancels = (intent: AnyIntent, live: Date | null): boolean => {
        const decided = intent.grace?.activityAt ?? null;
        const at =
            decided === null || (live !== null && live.getTime() > decided.getTime())
                ? live
                : decided;
        const warning = warningFor(intent.idempotencyKey);
        return at !== null && warning !== null && at.getTime() > warning.warnedAtMs;
    };

    /** Take the lease, or learn that a live worker holds it. */
    const claim = (effectId: string): boolean => {
        const at = clock();
        return store.claim(
            effectId,
            worker,
            at.toISOString(),
            new Date(at.getTime() - EFFECT_LEASE_STALE_MINUTES * 60_000).toISOString(),
        );
    };

    /** The externals for this pass, with the seam CONTAINED. */
    const freshExternals = async (): Promise<ReadAnswer<ShellExternals>> => {
        try {
            return { ok: true, value: await externals() };
        } catch (error) {
            return { ok: false, detail: detailOf(error) };
        }
    };

    /**
     * Contained the way `decide()` contains it: a lookup that threw established nothing,
     * and D51 rules an unestablished ordering a conflict, which the rules already refuse.
     */
    const orderingFor = async (
        facts: ShellExternals,
        item: ItemRef,
    ): Promise<HumanChangeOrdering> => {
        try {
            return await facts.latestHumanChangeAt(item);
        } catch {
            return "unknown";
        }
    };

    /**
     * The brakes an operator can still pull between deciding and applying, run by core
     * (`evaluateStandingRules`) and not copied. The shell decides WHICH rules to run. This item-independent subset is the whole gate a RESUME passes: add-then-remove leaves two position labels, so the full ladder could only answer `preconditionStale`.
     */
    const brakes = (pass: Pass, operation: IntentOperation, facts: ShellExternals): GateVerdict => {
        const operationFacts = INTENT_OPERATIONS[operation];
        const verdict = evaluateStandingRules(
            {
                capability: pass.capability,
                actionClass: operationFacts.actionClassFloor,
                requiredPermissions: [operationFacts.permission],
            },
            pass.config,
            {
                killSwitchActive: facts.killSwitchActive,
                installationGrants: facts.installationGrants,
            },
        );
        return verdict.outcome === "apply" ? { ok: true } : refuse(verdict.code, verdict.reason);
    };

    /** The brakes, over externals read fresh for this pass. */
    const resumeGate = async (pass: Pass, operation: IntentOperation): Promise<GateVerdict> => {
        const facts = await freshExternals();
        return facts.ok
            ? brakes(pass, operation, facts.value)
            : {
                  ok: false,
                  result: {
                      outcome: "retryLater",
                      code: "externalsUnavailable",
                      detail: `the apply-time externals could not be built: ${facts.detail}`,
                  },
              };
    };

    /**
     * The live answer to the mode this intent claimed, and to no other.
     * `draft` rides on the item read already made; the reviews list is a second call, spent only where a claim turns on it.
     */
    const modesClaimed = async (
        intent: AnyIntent,
        seen: ItemSeen,
    ): Promise<ReadAnswer<ObservedModes>> => {
        const claimed = intent.claims.pullRequestMode;
        if (claimed === undefined) return { ok: true, value: {} };
        if (claimed === "draft") return { ok: true, value: { draft: seen.draft } };
        const read = await reader.changesRequested(intent.item);
        return read.ok ? { ok: true, value: { changesRequested: read.value } } : read;
    };

    /**
     * The whole ladder again, against a LIVE read of the item.
     * This is what makes an approval a permission to act NOW rather than one banked at decision time. A mode that moved refuses under `preconditionStale`, as a meaning does.
     */
    const freshGate = async (pass: Pass, intent: AnyIntent): Promise<GateVerdict> => {
        const seen = await reader.item(intent.item);
        if (!seen.ok) {
            return {
                ok: false,
                result: {
                    outcome: "retryLater",
                    code: "itemUnreadable",
                    detail: `the item could not be read at apply time: ${seen.detail}`,
                },
            };
        }
        const modes = await modesClaimed(intent, seen.value);
        if (!modes.ok) {
            return {
                ok: false,
                result: {
                    outcome: "retryLater",
                    code: "itemUnreadable",
                    detail: `the pull request's mode could not be read at apply time: ${modes.detail}`,
                },
            };
        }
        const facts = await freshExternals();
        if (!facts.ok) {
            return {
                ok: false,
                result: {
                    outcome: "retryLater",
                    code: "externalsUnavailable",
                    detail: `the apply-time externals could not be built: ${facts.detail}`,
                },
            };
        }
        const request = writeRequestFor(intent);
        const activity =
            intent.grace !== null && intent.operation === "closePullRequest"
                ? await reader.pullRequestActivity(
                      intent.item,
                      pass.config.mappings.commands.working,
                  )
                : { ok: true as const, value: null };
        if (!activity.ok) {
            return {
                ok: false,
                result: {
                    outcome: "retryLater",
                    code: "itemUnreadable",
                    detail: `the pull request's activity could not be read at apply time: ${activity.detail}`,
                },
            };
        }
        const context = {
            killSwitchActive: facts.value.killSwitchActive,
            installationGrants: facts.value.installationGrants,
            latestHumanChangeAt: await orderingFor(facts.value, intent.item),
            world: deriveWorld(
                projectionFrom(seen.value, intent.item.kind, pass.config),
                intent.claims,
                modes.value,
            ),
        };
        // The same two doors the decision used (grace.md §2): the record is re-read
        // here, so a pruned warning or a re-warned repository changes the answer.

        const verdict =
            intent.grace === null
                ? evaluateWrite(request, pass.config, context)
                : evaluateDestructive(
                      {
                          request,
                          warning: warningFor(intent.idempotencyKey),
                          qualifyingActivitySinceWarning: activityCancels(intent, activity.value),
                      },
                      pass.config,
                      context,
                      clock(),
                  );
        return verdict.outcome === "apply" ? { ok: true } : refuse(verdict.code, verdict.reason);
    };

    // ── Sending and proving one call ────────────────────────────────

    /**
     * What one send of this pass's effect may know.
     * `isMine` is handed in: recognising the App's own comment is the choreography's business and not an operation's (D125).
     */
    const contextFor = (pass: Pass): SendContext => ({
        item: pass.item,
        writer,
        reader,
        isMine,
    });

    /** One call, sent by the handler that owns its verb. */
    const send = async (pass: Pass, call: Call): Promise<WriteResult> =>
        await sendCall(call, contextFor(pass));

    /** Does GitHub say this call's postcondition holds? */
    const confirm = async (pass: Pass, call: Call): Promise<Confirmation> =>
        await confirmCall(call, contextFor(pass));

    const HOUR_MS = 60 * 60 * 1000;

    /**
     * The warning this landed comment promises, written down (grace.md §3).
     * `warnedAt` is NOW, because the promise is made when the comment appears. Keyed by the ACT's effect id, and called only after a call is proved done.
     */
    const record = (pass: Pass, call: Call): void => {
        if (pass.records === null || call.verb !== "postComment") return;
        const warnedAt = clock();
        const { request } = pass.records;
        store.recordWarning({
            effectId: pass.records.effectId,
            warnedAt: warnedAt.toISOString(),
            gracePeriodHours: pass.records.gracePeriodHours,
            earliestActionAt: new Date(
                warnedAt.getTime() + pass.records.gracePeriodHours * HOUR_MS,
            ).toISOString(),
            cancelledBy: pass.records.cancelledBy,
            reversesWith: pass.records.reversesWith,
            actionClass: request.actionClass,
            capability: request.capability,
            causeObservedAt: request.causeObservedAt.toISOString(),
            cause: request.cause,
            item: request.target.item,
            change: request.target.change,
        });
    };

    /**
     * Journal, send, prove — in that order, always.
     * A definite refusal — conflict or forbidden — CLOSES the row: nothing landed and nothing will, so leaving it open would ask the sweep to re-decide a settled question.
     */
    const journalAndSend = async (pass: Pass, seq: number, call: Call): Promise<CallResult> => {
        store.intent(
            pass.effectId,
            seq,
            serializeCall({ capability: pass.capability, item: pass.item, call }),
            now(),
            pass.config.revision,
        );
        const answer = await send(pass, call);
        switch (answer.outcome) {
            case "applied": {
                const proof = await confirm(pass, call);
                if (proof !== "held") {
                    return stop(
                        "unknown",
                        "postconditionUnconfirmed",
                        `GitHub accepted the ${call.verb} but the read-back answered ${proof}`,
                    );
                }
                store.done(pass.effectId, seq, now());
                record(pass, call);
                return { kind: "done", changed: true };
            }
            case "already":
                store.done(pass.effectId, seq, now());
                record(pass, call);
                return { kind: "done", changed: false };
            case "conflict":
                store.done(pass.effectId, seq, now());
                return stop("refused", "writeConflict", answer.detail);
            case "forbidden":
                store.done(pass.effectId, seq, now());
                return stop("refused", "writeForbidden", answer.detail);
            case "retryLater":
                return stop("retryLater", "writeRetryLater", answer.detail);
            case "unknown":
                return stop("unknown", "writeUnknown", answer.detail);
        }
    };

    /**
     * One open `sent` row, resolved — the whole of `SENT-UNKNOWN`.
     * GitHub is asked BEFORE anything else. Only the resend branch meets a gate, because by then nothing has landed, so a world that now says no makes the row final.
     */
    const resolveOpen = async (
        pass: Pass,
        seq: number,
        call: Call,
        revision: string,
    ): Promise<CallResult> => {
        const proof = await confirm(pass, call);
        if (proof === "held") {
            store.done(pass.effectId, seq, now());
            record(pass, call);
            return { kind: "done", changed: true };
        }
        if (proof === "unknown") {
            return stop(
                "unknown",
                "writeUnknown",
                "the read-back could not establish whether this call landed",
            );
        }
        if (revision !== pass.config.revision) {
            store.done(pass.effectId, seq, now());
            return stop(
                "refused",
                "configurationChanged",
                "the configuration changed after this call was journalled; nothing was resent",
            );
        }
        const gate = await resumeGate(pass, operationOf(call));
        if (!gate.ok) {
            if (gate.result.outcome === "refused") store.done(pass.effectId, seq, now());
            return { kind: "stop", result: gate.result };
        }
        return await journalAndSend(pass, seq, call);
    };

    /** The plan from one call onward. The first stop ends the pass. */
    const runFrom = async (
        pass: Pass,
        calls: readonly Call[],
        startSeq: number,
        changedAlready: boolean,
    ): Promise<PassResult> => {
        let changed = changedAlready;
        for (let seq = startSeq; seq <= calls.length; seq += 1) {
            const result = await journalAndSend(pass, seq, calls[seq - 1]!);
            if (result.kind === "stop") return result.result;
            changed ||= result.changed;
        }
        return changed
            ? { outcome: "applied", code: null, detail: null }
            : { outcome: "already", code: null, detail: "every call in this plan already held" };
    };

    /** The open row a `sentUnknown` names, then whatever the plan has left. */
    const continueOpen = async (
        pass: Pass,
        seq: number,
        row: string,
        revision: string,
        calls: readonly Call[],
    ): Promise<PassResult> => {
        // Nothing can be resent from bytes nobody can read, and leaving the row open
        // would hand the sweep the same dead end forever.

        const journaled = parseJournaledCall(row);
        if (journaled === null) {
            store.done(pass.effectId, seq, now());
            return {
                outcome: "refused",
                code: "rowUnreadable",
                detail: "the journal row for this call could not be read; it is closed and nothing was resent",
            };
        }
        const resolved = await resolveOpen(pass, seq, journaled.call, revision);
        if (resolved.kind === "stop") return resolved.result;
        if (seq >= calls.length) {
            return { outcome: "applied", code: null, detail: null };
        }
        if (revision !== pass.config.revision) {
            return {
                outcome: "refused",
                code: "configurationChanged",
                detail: "the configuration changed after this effect started; nothing else was sent",
            };
        }
        const gate = await resumeGate(pass, operationOf(journaled.call));
        if (!gate.ok) return gate.result;
        return await runFrom(pass, calls, seq + 1, true);
    };

    /** The dispatch: the recovery loop's four states, four answers. */
    const drive = async (
        pass: Pass,
        intent: AnyIntent,
        calls: readonly Call[],
    ): Promise<PassResult> => {
        const state = store.effectState(pass.effectId, calls.length);
        if (state.state === "complete") {
            return {
                outcome: "already",
                code: null,
                detail: "the journal says every call in this effect's plan is done",
            };
        }
        if (state.state === "sentUnknown") {
            return await continueOpen(pass, state.seq, state.intent, state.revision, calls);
        }
        if (state.state === "midSequence") {
            if (state.revision !== pass.config.revision) {
                return {
                    outcome: "refused",
                    code: "configurationChanged",
                    detail: "the configuration changed after this effect started; nothing was resumed",
                };
            }
            const gate = await resumeGate(pass, intent.operation);
            return gate.ok ? await runFrom(pass, calls, state.lastDoneSeq + 1, true) : gate.result;
        }
        const gate = await freshGate(pass, intent);
        return gate.ok ? await runFrom(pass, calls, 1, false) : gate.result;
    };

    /** One approved effect, under its own lease, released on every exit. */
    const apply = async (effect: Effect, config: RepositoryConfig): Promise<EffectOutcome> => {
        const { intent } = effect;
        const pass: Pass = {
            effectId: intent.idempotencyKey,
            capability: intent.capability,
            item: intent.item,
            config,
            records: effect.records,
        };
        const outcomeOf = (result: PassResult): EffectOutcome => ({
            effectId: pass.effectId,
            capability: pass.capability,
            operation: intent.operation,
            item: pass.item,
            ...result,
        });

        const plan = planFor(effect, config);
        if (!plan.ok) {
            return outcomeOf({ outcome: "refused", code: plan.code, detail: plan.detail });
        }
        if (!claim(pass.effectId)) {
            return outcomeOf({
                outcome: "unknown",
                code: "leaseHeld",
                detail: "a live worker holds this effect's lease",
            });
        }
        try {
            return outcomeOf(await drive(pass, intent, plan.calls));
        } finally {
            store.release(pass.effectId, worker);
        }
    };

    return {
        async applyAll(effects, config) {
            const outcomes: EffectOutcome[] = [];
            for (const effect of effects) outcomes.push(await apply(effect, config));
            return outcomes;
        },

        /**
         * One open row the sweep found, resolved and reported.
         * Log-only, and a row still open at the end says nothing: the sweep meets it again.
         */
        async recover(open, config) {
            const journaled = parseJournaledCall(open.intent);
            if (journaled === null) {
                store.done(open.effectId, open.seq, now());
                log({
                    event: "effectRefused",
                    effectId: open.effectId,
                    seq: open.seq,
                    code: "rowUnreadable",
                    detail: "the journal row could not be read; it is closed and nothing was resent",
                });
                return;
            }
            if (open.attempt >= EFFECT_ATTEMPT_CAP) {
                store.done(open.effectId, open.seq, now());
                log({
                    event: "effectAbandoned",
                    effectId: open.effectId,
                    seq: open.seq,
                    attempts: open.attempt,
                });
                return;
            }
            const pass: Pass = {
                effectId: open.effectId,
                capability: journaled.capability,
                item: journaled.item,
                config,
                records: null,
            };
            if (!claim(open.effectId)) return;
            try {
                const resolved = await resolveOpen(pass, open.seq, journaled.call, open.revision);
                if (resolved.kind === "done") {
                    log({ event: "effectApplied", effectId: open.effectId, seq: open.seq });
                } else if (resolved.result.outcome === "refused") {
                    log({
                        event: "effectRefused",
                        effectId: open.effectId,
                        seq: open.seq,
                        code: resolved.result.code,
                        detail: resolved.result.detail,
                    });
                }
            } finally {
                store.release(open.effectId, worker);
            }
        },
    };
}
