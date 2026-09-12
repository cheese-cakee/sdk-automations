/**
 * How one approved effect becomes a landed GitHub change, exactly once.
 *
 * Stage C. `effects.ts` says what an effect's calls ARE and `operations/`
 * says what each one plans, spells and sends; this file is the choreography
 * around them — the lease, the journal, the send, the read-back that proves
 * it — and it owns every seam the choreography needs. Nothing here knows a
 * verb; the two dispatches below hand each call to its own handler.
 *
 * The dispatch is the storage decision's recovery loop, verbatim: the journal
 * says WHAT to check, GitHub says HOW IT ENDED, and the call's idempotency
 * decides how a retry may be performed. Four journal states, four answers.
 *
 * ```
 * complete     → nothing sent; the effect already landed
 * midSequence  → resume at the next call
 * sentUnknown  → read GitHub back BEFORE anything, then close or resend
 * neverStarted → re-gate against a LIVE read, then journal → send → verify
 * ```
 *
 * Two rules run through all of it. Nothing is sent that was not journalled
 * first, so a crash between the two is a row a later pass resolves rather than
 * a change nobody recorded. And nothing is closed that was not read back, so
 * "done" always means a read said so.
 *
 * The seams a send uses now live in `operations/handler.ts`, where the
 * handlers that call them are, and are re-exported here because that is where
 * the package's public surface has always named them. They restate shapes the
 * adapter already has, which is deliberate and enforced:
 * `.dependency-cruiser.cjs` admits the adapter at `main.ts` and nowhere else,
 * so the shell names what it needs and the composition root passes the
 * adapter's own objects, which satisfy it structurally. Same idiom as
 * `ExternalsForDelivery`, and `main.ts` is where the two shapes are checked
 * against each other.
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

/**
 * The seam vocabulary, re-exported from its new home.
 *
 * These names are the package's write-path surface — `main.ts` checks the
 * adapter against two of them — and they were exported from this file before
 * the handlers moved out of it. The re-export keeps the barrel's name set
 * exactly what it was.
 */
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
 *
 * Ten minutes exceeds the write client's local request budget and reduces
 * ordinary recovery overlap. It is not a proof that GitHub stopped processing
 * a timed-out request, so live takeover remains open under D41.
 */
export const EFFECT_LEASE_STALE_MINUTES = 10;

/**
 * How many times one call may be declared before recovery gives up on it.
 *
 * The journal's `attempt` column counts durably, across restarts, so this is a
 * bound on the effect rather than on a process (D42). A call that has been
 * sent five times and never confirmed is not one more send away from working;
 * it is a thing an operator has to look at, which is what `effectAbandoned`
 * is for.
 */
export const EFFECT_ATTEMPT_CAP = 5;

// ─── The seams ───────────────────────────────────────────────────────

/**
 * A FRESH externals set, built per apply pass.
 *
 * Never the delivery's own: that one memoises each item's ordering evidence
 * for the length of one decision, which is right for a decision and wrong
 * here. Between deciding and applying, a human can change the item — and a
 * memo would answer the apply-time gate with the instant the DECISION read,
 * which is the one thing a re-gate exists to stop believing.
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
    /**
     * The warning this pass's comment records when it lands, or `null` for
     * every other effect — and for every RECOVERY pass, which resends from a
     * row and has no approval to carry one.
     *
     * A warning resent by recovery therefore records nothing, and that is
     * self-healing rather than lost: with no record standing, the next
     * decision approves the warning effect again, the comment read-back
     * answers `already`, and the record is written from the approval that time.
     */
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
 *
 * A closed item's reason is read as far as this endpoint can tell it: a merged
 * pull request is `merged`, and everything else closed is `closedByHuman`. The
 * third reason — an issue completed by a linked merge — is not distinguishable
 * from an item read, and does not need to be: every closure refuses the write
 * with the same rule, so the choice cannot change a verdict.
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
 * Is this comment the one the call about to be sent would BE? Authorship and
 * identity, both required (D125).
 *
 * The identity comes from the call's own rendered body, which is where the
 * platform published it, rather than from anything the pass carries. That is
 * what a resend has: the journal row holds the rendered body and never the
 * identity, and a subject digest cannot be reversed — so a recovery pass and a
 * fresh one ask exactly the same question, and the answer is per item and
 * purpose rather than per occasion (D145).
 *
 * A body publishing no readable identity matches nothing, which is the honest
 * answer rather than a lenient one: identity is what the marker says, and a
 * marker this reader cannot read says nothing to it. Today's plan always
 * renders one it can, so that is a row from an older schema or a corrupt one —
 * and such a call can never be confirmed either, which is what leaves it to the
 * attempt cap rather than to a guess.
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
     *
     * Not through `externals`: a warning is the platform's own record rather
     * than a fact about GitHub, so every composition that owns a store can
     * answer it, and the credential-free path is not thereby left unable to
     * gate its own destructive acts (grace.md §2).
     */
    const warningFor = recordedWarningsIn(store);

    /**
     * Did the affected person act after they were warned?
     *
     * The instant is the DECISION's reading, which is the honest limit of what
     * a re-gate can know here: the applier reads no timeline. It is not the
     * only guard — the ordering evidence below refuses a write over a newer
     * human change on its own — so this narrows rather than carries the claim.
     */
    const activityCancels = (intent: AnyIntent): boolean => {
        const at = intent.grace?.activityAt ?? null;
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
     * The ordering evidence for one item, CONTAINED the way `decide()`
     * contains it: a lookup that threw established nothing, and D51 rules an
     * unestablished ordering a conflict — which the rules already refuse.
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
     * The brakes an operator can still pull between deciding and applying:
     * the kill switch, the repository's mode, whether the capability is
     * enabled, and whether the installation still grants the permission.
     *
     * Core's own rules, run by core (`evaluateStandingRules`) — not a copy.
     * The five checks were written out here once, and a shell that restates a
     * safety ladder is a second ladder waiting to disagree with the first
     * about whether a repository still says yes. What the shell decides is
     * WHICH rules to run; how each one answers, in what order, and under which
     * code stays core's.
     *
     * The subset is the item-independent half, and it is the whole gate a
     * RESUME passes. The full ladder is not re-run on a resume, and the reason
     * is add-then-remove: a half-done label swap leaves the item holding two
     * position labels, which projects as a conflict, which `deriveWorld`
     * reports as no authoritative precondition — so `evaluateWrite` could only
     * ever answer `preconditionStale` there. The conflict is this platform's
     * own intermediate, and the remaining call is exactly what clears it;
     * refusing would leave the item conflicted for good, which is worse for a
     * human than finishing the move they can then re-edit.
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
     * The whole ladder again, against a LIVE read of the item.
     *
     * This is what makes an approval a permission to act NOW rather than a
     * permission banked at decision time. The item is re-read, the projection
     * rebuilt from its current labels, and the ordering evidence taken from a
     * source built for this pass — so a human change made in the gap between
     * deciding and applying refuses the write, which a memo carried over from
     * the decision could not do.
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
        const context = {
            killSwitchActive: facts.value.killSwitchActive,
            installationGrants: facts.value.installationGrants,
            latestHumanChangeAt: await orderingFor(facts.value, intent.item),
            world: deriveWorld(
                projectionFrom(seen.value, intent.item.kind, pass.config),
                intent.claims,
            ),
        };
        // The same two doors the decision used (grace.md §2), for the same
        // reason the world is re-derived: an approval is permission to act NOW.
        // A grace that ran out at decision time is still the promise that
        // binds, but the record is re-read here — a warning pruned, or a
        // repository that has since been re-warned, changes the answer.
        const verdict =
            intent.grace === null
                ? evaluateWrite(request, pass.config, context)
                : evaluateDestructive(
                      {
                          request,
                          warning: warningFor(intent.idempotencyKey),
                          qualifyingActivitySinceWarning: activityCancels(intent),
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
     *
     * `isMine` is handed in rather than left to the handler, for the reason it
     * always was: recognising the App's own comment is the choreography's
     * business and not an operation's (D125).
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

    const DAY_MS = 24 * 60 * 60 * 1000;

    /**
     * The warning this landed comment promises, written down (grace.md §3).
     *
     * `warnedAt` is NOW, not the decision's instant, because the promise is
     * made when the comment appears; `earliestActionAt` follows from it, so
     * the date the record holds is the date the grace actually starts from.
     * Keyed by the ACT's effect id: the warning comment is how the promise got
     * published, and the act is what it authorizes.
     *
     * Called only after a call is proved done, which is what makes "a warning
     * that never posted authorizes nothing" true — nothing records it.
     */
    const record = (pass: Pass, call: Call): void => {
        if (pass.records === null || call.verb !== "postComment") return;
        const warnedAt = clock();
        const { request } = pass.records;
        store.recordWarning({
            effectId: pass.records.effectId,
            warnedAt: warnedAt.toISOString(),
            gracePeriodDays: pass.records.gracePeriodDays,
            earliestActionAt: new Date(
                warnedAt.getTime() + pass.records.gracePeriodDays * DAY_MS,
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
     *
     * `store.intent` is the row that survives a crash between here and
     * GitHub; re-declaring an open call increments its durable attempt
     * counter, which is what a resend does and what the cap counts. A definite
     * refusal — conflict or forbidden — CLOSES the row: nothing landed and
     * nothing will, so leaving it open would ask the sweep to re-decide a
     * question GitHub has already answered.
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
     *
     * GitHub is asked BEFORE anything else, because the row says only that a
     * call was declared. A confirmed postcondition closes the row without a
     * second send. A confirmed absence earns a resend, and only that branch
     * meets a gate: by then nothing has landed, so a world that now says no
     * makes the row final rather than pending. An unknown read leaves the row
     * exactly as it was, for a later pass with a luckier read.
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
        const journaled = parseJournaledCall(row);
        if (journaled === null) {
            // Nothing can be resent from bytes nobody can read, and leaving
            // the row open would hand the sweep the same dead end forever.
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
            // Not a failure: the holder is working on it, or will be told it
            // lost the lease. Either way this pass has nothing safe to add.
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
         *
         * Log-only: a recovery pass has no delivery record to write into, so
         * the operator log is the whole account of it. A row still open at the
         * end says nothing — the sweep meets it again next tick, and a line
         * every minute would bury the ones that matter.
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
