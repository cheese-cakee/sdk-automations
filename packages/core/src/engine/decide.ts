/**
 * decide() — the one verb (D92). A delivery or a fact record goes in; a
 * report and the approved intents come out; nothing else escapes.
 *
 * This file OWNS the composition: normalize → evaluate → screen → derive
 * the world → gate → report. `events.ts` is the first of those steps and
 * `invoke.ts` holds the erased capability shape this walks over.
 *
 * Externals are only the facts core cannot know — clock, kill switch,
 * grants, human ordering, resolver answers — as data and lookups, never
 * I/O. Everything derivable is derived, so a caller cannot assert a world
 * that contradicts the one it delivered.
 */

import {
    addressManagedComment,
    factGroupUnread,
    managedCommentOf,
    projectCapabilityView,
    readIntent,
    screenIntent,
    type AnyIntent,
    type CapabilityView,
    type DestructiveGrace,
    type Facts,
    type Intent,
    type ItemRef,
    type ManagedComment,
    type RepositoryRef,
    type TypedDeclaration,
} from "../capability/index.js";
import type { PermissionGrant } from "../github/index.js";
import {
    EngineHandle,
    thrownDetail,
    type EngineCapability,
    type ResolverSource,
} from "./invoke.js";
import { normalizeDelivery } from "./events.js";
import type { RepositoryConfig } from "../config/index.js";
import {
    deriveWorld,
    evaluateDestructive,
    evaluateWrite,
    type DestructiveWarning,
    type HumanChangeOrdering,
    type PendingWarning,
    type SafetyVerdict,
    type WriteContext,
} from "../safety/index.js";
import {
    explanationFinding,
    finding,
    screenFinding,
    verdictFinding,
    type Finding,
    type Report,
    type Subject,
} from "../report/index.js";
import { wouldApplyFinding, writeRequestFor } from "./change.js";

// ─── What goes in, what comes out ────────────────────────────────────

/** The facts core cannot derive, supplied as data and lookups rather than I/O. */
export interface Externals {
    readonly killSwitchActive: boolean;
    readonly installationGrants: readonly PermissionGrant[];
    /**
     * Ordering evidence per item; `"unknown"` is a safe conflict
     * (`design/contracts/safety.md` §3). The engine awaits either shape, so a synchronous
     * stub and a timeline-reading live implementation satisfy the same seam —
     * a lookup that returns a promise is still a lookup, not I/O in core.
     */
    readonly latestHumanChangeAt: (
        item: ItemRef,
    ) => HumanChangeOrdering | Promise<HumanChangeOrdering>;
    /** Resolver answers, when the shell has them. Absent means unavailable. */
    readonly resolve?: ResolverSource;
    /**
     * The warning already recorded for one effect, or `null` for none
     * (grace.md §2). Absent is "none recorded", the way an absent `resolve`
     * is "unavailable": a composition with no store has warned nobody, and
     * the destructive door refuses an act on that answer rather than acting.
     *
     * The shell reads the row and re-mints it through
     * `createDestructiveWarning`, which is the only constructor — so a
     * warning reaching this seam was authored by the platform even though the
     * bytes it was rebuilt from crossed a durability boundary.
     */
    readonly warningFor?: (
        effectId: string,
    ) => DestructiveWarning | null | Promise<DestructiveWarning | null>;
}

/**
 * One thing to decide about: a raw delivery, or a fact record the caller
 * already holds. The raw branch carries the shell's routing knowledge
 * separately, because a report must name its repository even when the
 * payload turns out to be unreadable.
 *
 * One record, one item (contracts/facts.md §4). A sweep hands the engine a
 * record per item rather than a list, so a decision is about one item and the
 * batching the engine used to unpick is gone.
 */
export type DecideInput =
    | {
          readonly kind: "delivery";
          readonly repository: RepositoryRef;
          readonly event: string;
          readonly payload: unknown;
      }
    | { readonly kind: "facts"; readonly facts: Facts };

/**
 * An intent that may act, carrying the identity only the platform can mint.
 *
 * `managedComment` is `null` for every operation that posts none. Identity
 * attaches HERE rather than in the factory (D125): an effect's identity is the
 * name under which a write will be found again, and an intent that will never
 * be written has none to name. The factory would also be handing it back to the
 * capability that must not own it, which is the arrangement D125 removed.
 */
/**
 * A warning authored but not yet posted, and the act it will authorize.
 *
 * `effectId` is the ACT's, not the warning comment's: the record is keyed by
 * the effect the destructive door will later ask about, and the warning is
 * only how it got written. Everything else is what the applier needs to mint
 * one once GitHub says the comment landed (grace.md §3).
 */
export interface WarningToRecord extends PendingWarning {
    readonly effectId: string;
}

export interface Effect {
    readonly intent: AnyIntent;
    readonly managedComment: ManagedComment | null;
    /**
     * The warning this effect's comment RECORDS when it lands, or `null` for
     * every effect that records none (grace.md §3).
     *
     * Only a platform-authored warning effect carries one, and it carries the
     * ACT's authority: the snapshot the destructive door will later match the
     * act against, plus the terms the record must keep. The applier supplies
     * the two instants — a warning that never posted authorizes nothing,
     * because nothing records it.
     */
    readonly records: WarningToRecord | null;
}

/** What one decision produced: the record and any active-mode effects. */
export interface Decision {
    readonly report: Report;
    /** Effects that passed every gate in `active` mode. */
    readonly approved: readonly Effect[];
}

// ─── The gates one intent passes ─────────────────────────────────────

/**
 * The refusal for an intent that names somebody else's item.
 *
 * One record is one item (facts.md §4), so the record's projection describes
 * THAT item and nothing else. An intent naming a different one would be judged
 * — closed, blocked, preconditions and all — against the wrong item's world,
 * which is unsound: a capability could act on a neighbour by asserting nothing
 * about it. So it is refused, in the same shape the old per-item lookup
 * produced when a sweep did not carry the item.
 */
const NOT_THIS_RECORD: SafetyVerdict = {
    outcome: "refuse",
    code: "preconditionStale",
    reason: "the intent names an item this record does not carry",
};

/** Whether an intent is about the item the record carries. */
function namesTheRecord(intent: AnyIntent, facts: Facts): boolean {
    return (
        intent.repository.owner === facts.repository.owner &&
        intent.repository.repo === facts.repository.repo &&
        intent.item.kind === facts.item.kind &&
        intent.item.number === facts.item.number
    );
}

/**
 * The ordering evidence for one item, with the lookup CONTAINED.
 *
 * A seam that threw established nothing, and D51 rules an unestablished
 * ordering a conflict — so the contained value is `"unknown"`, which the rules
 * already refuse fail-closed. The detail rides alongside because "checked and
 * could not tell" and "the lookup broke" need different fixes.
 */
async function orderingFor(
    item: ItemRef,
    externals: Externals,
): Promise<{ readonly value: HumanChangeOrdering; readonly defect: string | null }> {
    try {
        return { value: await externals.latestHumanChangeAt(item), defect: null };
    } catch (thrown) {
        return { value: "unknown", defect: thrownDetail(thrown) };
    }
}

/**
 * The managed-comment identity for an intent that has one, minted from the
 * intent's OWN fields — the capability it is attributed to, the item it names,
 * the purpose it asked for, and the topic that tells two of that purpose apart.
 *
 * The occasion is NOT among them (D145). A new event about the same item is
 * the same comment, rewritten; the occasion's name is the journal's effect id,
 * and it is the intent's idempotency key, which stays exactly what it was.
 *
 * TWO intents have one. A `postManagedComment` posts the comment it names,
 * and a GRACED act posts one AFTER it lands: the outcome notice grace.md §3
 * requires, under the act's own topic, so the notice and the warning that
 * preceded it stand on the same person's clock. This is the one place a
 * non-comment operation is handed an identity, and it is here for the same
 * reason the other is: identity attaches where a write will be found again,
 * and a graced act will be (D125).
 */
/**
 * The intent as the platform will act on it: a comment that names a principal
 * has that name resolved into the handle behind it before anything else sees
 * the body.
 *
 * Here rather than inside `gateIntent` because everything downstream must read
 * the SAME bytes — the verdict, the `wouldApply` a dry-run reports, the managed
 * body the applier journals. A capability supplies content and a name; the
 * platform composes the comment (`managed.ts`).
 */
function addressed(intent: AnyIntent, config: RepositoryConfig): AnyIntent {
    if (intent.operation !== "postManagedComment") return intent;
    const body = addressManagedComment(
        intent.desired.body,
        intent.desired.mention,
        config.principals,
    );
    return body === intent.desired.body
        ? intent
        : { ...intent, desired: { ...intent.desired, body } };
}

function managedCommentFor(intent: AnyIntent): ManagedComment | null {
    if (intent.operation === "postManagedComment") {
        return managedCommentOf({
            capability: intent.capability,
            item: intent.item,
            kind: intent.desired.kind,
            topic: intent.desired.topic ?? "",
        });
    }
    return intent.grace === null
        ? null
        : managedCommentOf({
              capability: intent.capability,
              item: intent.item,
              kind: "notice",
              topic: intent.grace.topic ?? "",
          });
}

/**
 * The warning comment the platform posts on an act's first sight — authored
 * HERE, from the act, because no capability may request one (grace.md §2).
 *
 * Everything but the words is the act's: the capability it is attributed to,
 * the item, the occasion, the topic, and the story the report already tells
 * about why this is happening. The effect id is the act's with a `warning`
 * suffix, so the warning and the act are two effects the journal can tell
 * apart while a reader can still see they are one plan. The COMMENT identity
 * is the act's topic under kind `warning`, so an issue with two stale
 * assignees earns two warnings and each names one clock (grace.md §3, D145).
 *
 * `claims: { closed: false }` is the only claim it makes, and it is the
 * right one: a warning about an act on a closed item is a promise the
 * destructive door would refuse to keep.
 */
function warningEffectFor(act: AnyIntent, grace: DestructiveGrace): Intent<"postManagedComment"> {
    return {
        capability: act.capability,
        repository: act.repository,
        item: act.item,
        operation: "postManagedComment",
        claims: { meaningsPresent: [], meaningsAbsent: [], closed: false },
        desired: { kind: "warning", topic: grace.topic ?? "", body: grace.warning.body },
        cause: act.cause,
        ...(act.evaluatedAt === undefined ? {} : { evaluatedAt: act.evaluatedAt }),
        explanation: act.explanation,
        idempotencyKey: `${act.idempotencyKey}:warning`,
        grace: null,
    };
}

/**
 * The recorded warning for one effect, with the lookup CONTAINED.
 *
 * A seam that threw established nothing, and "nothing" must not read as "no
 * warning": that answer would post a second warning and re-date the promise
 * the person was given. So the defect rides alongside and the caller declines
 * to act at all, which is the only answer that neither warns twice nor acts
 * unwarned.
 */
async function recordedWarning(
    effectId: string,
    externals: Externals,
): Promise<{ readonly value: DestructiveWarning | null; readonly defect: string | null }> {
    try {
        return { value: (await externals.warningFor?.(effectId)) ?? null, defect: null };
    } catch (thrown) {
        return { value: null, defect: thrownDetail(thrown) };
    }
}

/**
 * What one verdict on one intent is worth saying, and whether it may act.
 *
 * Both routes below end here, which is what keeps the report the same shape
 * whether the platform is warning or acting: an acting intent tells its story,
 * a refusal keeps its reason alone (D92 3d), and dry-run adds the rehearsal
 * line naming what THIS intent would have done — "warn", where the platform
 * has substituted its own warning for the act it is holding back.
 */
function outcomeOf(
    intent: AnyIntent,
    verdict: SafetyVerdict,
    config: RepositoryConfig,
    subject: Subject,
    records: WarningToRecord | null,
): { readonly findings: readonly Finding[]; readonly approved: Effect | null } {
    const effectSubject = {
        kind: "effect",
        capability: intent.capability,
        item: intent.item,
        operation: intent.operation,
    } as const;
    const findings: Finding[] = [];
    if (verdict.outcome !== "refuse") {
        findings.push(explanationFinding(intent.explanation, subject));
    }
    findings.push(verdictFinding(verdict, effectSubject));
    // After the verdict, because it elaborates on it: the verdict says the
    // mode recorded rather than applied, and this says what it recorded.
    if (
        config.mode === "dry-run" &&
        verdict.outcome === "record-only" &&
        verdict.code === "modeRecordsOnly"
    ) {
        findings.push(wouldApplyFinding(intent, effectSubject));
    }
    return {
        findings,
        approved:
            verdict.outcome === "apply"
                ? { intent, managedComment: managedCommentFor(intent), records }
                : null,
    };
}

/**
 * One intent through every gate — screen, own item, derived world, verdict —
 * returning its findings and, if it may act, the effect itself. Async for two
 * facts: the ordering evidence and, for a graced act, the recorded warning,
 * both awaited after the screen so a screened-out intent costs no lookup.
 *
 * TWO DOORS (grace.md §2). An ordinary intent meets `evaluateWrite`. A graced
 * act — which the screen has already proved is the clock-triggered destructive
 * class, and the only class carrying grace — meets one of two things instead:
 * with no warning recorded, the platform's OWN warning comment is what gets
 * gated and approved in its place, carrying the act's authority for the
 * applier to record; with one recorded, `evaluateDestructive` judges the act
 * against it. The act is never approved on its first sight, because on its
 * first sight there is nothing to have warned in.
 */
async function gateIntent(
    value: unknown,
    declaration: TypedDeclaration,
    facts: Facts,
    config: RepositoryConfig,
    externals: Externals,
): Promise<{ readonly findings: readonly Finding[]; readonly approved: Effect | null }> {
    const parsed = readIntent(value);
    if (parsed === null) {
        return {
            findings: [
                screenFinding(
                    {
                        ok: false,
                        code: "malformedIntent",
                        reason: "the capability returned a malformed intent",
                    },
                    { kind: "capability", capability: declaration.name },
                ),
            ],
            approved: null,
        };
    }
    const intent = addressed(
        { ...parsed, evaluatedAt: new Date(facts.observedAt.getTime()) },
        config,
    );
    const subject = {
        kind: "item",
        capability: declaration.name,
        item: intent.item,
    } as const;
    const screen = screenIntent(intent, declaration, facts.position);
    if (!screen.ok) {
        return { findings: [screenFinding(screen, subject)], approved: null };
    }
    // Before the world is derived, because there is no world to derive: the
    // only projection here belongs to another item.
    if (!namesTheRecord(intent, facts)) {
        return {
            findings: [
                verdictFinding(NOT_THIS_RECORD, {
                    kind: "effect",
                    capability: declaration.name,
                    item: intent.item,
                    operation: intent.operation,
                }),
            ],
            approved: null,
        };
    }

    const ordering = await orderingFor(intent.item, externals);
    const before: Finding[] =
        ordering.defect === null
            ? []
            : [
                  finding(
                      "problem",
                      "humanOrderingLookupFailed",
                      `the human-change ordering lookup threw: ${ordering.defect}`,
                      subject,
                  ),
              ];
    /** One world per claim: the act's own, or the warning's `closed: false`. */
    const contextFor = (request: AnyIntent): WriteContext => ({
        killSwitchActive: externals.killSwitchActive,
        installationGrants: externals.installationGrants,
        latestHumanChangeAt: ordering.value,
        world: deriveWorld(facts.position, request.claims),
    });
    const said = (
        result: ReturnType<typeof outcomeOf>,
    ): { readonly findings: readonly Finding[]; readonly approved: Effect | null } => ({
        findings: [...before, ...result.findings],
        approved: result.approved,
    });

    // `?? null` for the reason the screen reads it that way: the field may
    // simply be absent on an intent built from `unknown`, and no terms is what
    // the screen has already proved is right for this operation's class.
    const grace = intent.grace ?? null;
    if (grace === null) {
        const verdict = evaluateWrite(writeRequestFor(intent), config, contextFor(intent));
        return said(outcomeOf(intent, verdict, config, subject, null));
    }

    const recorded = await recordedWarning(intent.idempotencyKey, externals);
    if (recorded.defect !== null) {
        return {
            findings: [
                ...before,
                finding(
                    "problem",
                    "warningLookupFailed",
                    `the recorded-warning lookup threw, so nothing was warned and nothing acted: ${recorded.defect}`,
                    subject,
                ),
            ],
            approved: null,
        };
    }
    if (recorded.value === null) {
        const warning = warningEffectFor(intent, grace);
        const verdict = evaluateWrite(writeRequestFor(warning), config, contextFor(warning));
        return said(
            outcomeOf(warning, verdict, config, subject, {
                effectId: intent.idempotencyKey,
                request: writeRequestFor(intent),
                gracePeriodDays: grace.days,
                cancelledBy: grace.cancelledBy,
                reversesWith: grace.reversesWith,
            }),
        );
    }
    const verdict = evaluateDestructive(
        {
            request: writeRequestFor(intent),
            warning: recorded.value,
            // The capability reports the activity; the platform decides what
            // it means, by comparing it against the promise IT recorded.
            qualifyingActivitySinceWarning:
                grace.activityAt !== null && grace.activityAt.getTime() > recorded.value.warnedAtMs,
        },
        config,
        contextFor(intent),
        facts.observedAt,
    );
    return said(outcomeOf(intent, verdict, config, subject, null));
}

/**
 * One capability's intents, with the CALL contained.
 *
 * A capability is ordinary code and may throw. The engine is total, so a
 * throw becomes a recorded defect and that capability simply contributes
 * nothing — the same bargain `EngineHandle` already makes for an undeclared
 * resolver. Whatever the capability explained before it broke is kept: the
 * handle holds it, and it is the only account of what it was doing.
 */
async function intentsFrom(
    capability: EngineCapability,
    facts: Facts,
    view: CapabilityView<TypedDeclaration>,
    handle: EngineHandle,
): Promise<{ readonly intents: readonly unknown[]; readonly defect: string | null }> {
    try {
        // The `never`s are `toEngine`'s erasure showing through; its
        // docstring owns the soundness argument, once, for all three.
        const intents: unknown = await capability.evaluate(
            facts as never,
            view as never,
            handle as never,
        );
        return Array.isArray(intents)
            ? { intents: [...intents], defect: null }
            : { intents: [], defect: "the capability returned a non-array intent collection" };
    } catch (thrown) {
        return { intents: [], defect: thrownDetail(thrown) };
    }
}

// ─── The verb ────────────────────────────────────────────────────────

/**
 * What this input is about: the record to decide on, the repository the report
 * must name, and whatever reading a raw delivery had to say.
 *
 * The repository is carried separately from the record because a report names
 * its repository even when the payload turns out to be unreadable — the shell
 * routed for one, and an operator has to be told which.
 */
function readInput(
    input: DecideInput,
    config: RepositoryConfig,
): {
    readonly repository: RepositoryRef;
    readonly facts: Facts | null;
    readonly findings: readonly Finding[];
} {
    if (input.kind === "facts") {
        return { repository: input.facts.repository, facts: input.facts, findings: [] };
    }
    const normalized = normalizeDelivery(input.event, input.payload, config);
    if (normalized.kind === "facts") {
        return {
            repository: normalized.facts.repository,
            facts: normalized.facts,
            findings: [],
        };
    }
    const refusal =
        normalized.kind === "ignored"
            ? finding("info", "deliveryIgnored", `event "${normalized.event}" carries no facts`, {
                  kind: "repository",
              })
            : finding("problem", normalized.code, normalized.detail, { kind: "repository" });
    return { repository: input.repository, facts: null, findings: [refusal] };
}

/**
 * The front door: a delivery becomes a report, plus the intents that may act.
 *
 * Total: every fallible seam is contained, so a report always comes back. An
 * unreadable payload, a capability that asks for an undeclared resolver or
 * throws, a resolver source or ordering lookup that rejects, and a refused
 * write are all findings. A shell that cannot get a report back cannot record
 * one, and in a reclaiming shell that loses the delivery for good.
 */
export async function decide(
    input: DecideInput,
    config: RepositoryConfig,
    capabilities: readonly EngineCapability[],
    externals: Externals,
): Promise<Decision> {
    const read = readInput(input, config);
    const findings: Finding[] = [...read.findings];
    const approved: Effect[] = [];
    const facts = read.facts;

    if (facts !== null) {
        for (const capability of capabilities) {
            const declaration = capability.declaration;
            if (config.capabilities[declaration.name]?.enabled !== true) continue;
            if (!declaration.facts.includes(facts.kind)) continue;
            const unread = declaration.needs.filter((group) => factGroupUnread(facts, group));
            if (unread.length > 0) {
                findings.push(
                    finding(
                        "info",
                        "factsUnread",
                        `"${declaration.name}" needs ${unread.join(", ")}, which this producer did not read`,
                        { kind: "capability", capability: declaration.name },
                    ),
                );
                continue;
            }

            const handle = new EngineHandle(declaration, externals.resolve);
            const view = projectCapabilityView(declaration, config);
            const evaluated = await intentsFrom(capability, facts, view, handle);

            for (const explanation of handle.explanations) {
                findings.push(
                    explanationFinding(explanation, {
                        kind: "capability",
                        capability: declaration.name,
                    }),
                );
            }
            for (const resolver of handle.violations) {
                findings.push(
                    finding(
                        "problem",
                        "undeclaredResolver",
                        `"${declaration.name}" asked for undeclared resolver "${resolver}"`,
                        { kind: "capability", capability: declaration.name },
                    ),
                );
            }
            for (const failure of handle.failures) {
                findings.push(
                    finding(
                        "problem",
                        "resolverFailed",
                        `the resolver failed answering "${declaration.name}" — ${failure}`,
                        { kind: "capability", capability: declaration.name },
                    ),
                );
            }
            if (evaluated.defect !== null) {
                findings.push(
                    finding(
                        "problem",
                        "capabilityFailed",
                        `"${declaration.name}" failed during evaluation: ${evaluated.defect}`,
                        { kind: "capability", capability: declaration.name },
                    ),
                );
            }

            for (const intent of evaluated.intents) {
                // The record IS one item, so its own projection is the world
                // every intent of this decision is judged against — and an
                // intent naming another item has none (facts.md §4).
                const gated = await gateIntent(intent, declaration, facts, config, externals);
                findings.push(...gated.findings);
                if (gated.approved !== null) approved.push(gated.approved);
            }
        }
    }

    return {
        report: {
            revision: config.revision,
            mode: config.mode,
            repository: read.repository,
            findings,
        },
        approved,
    };
}
