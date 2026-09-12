/**
 * What a capability asks for, and the screens every request passes.
 *
 * An intent describes a desired OUTCOME, not an API call. Translation into
 * GitHub calls is deliberately outside `core/` and is not implemented yet.
 */

import { MAPPABLE_MEANINGS, type MappableMeaning } from "../config/index.js";
import { MIN_GRACE_DAYS, type ClaimedFacts } from "../safety/index.js";
import {
    canTransitionIssue,
    canTransitionPr,
    isIssueCause,
    isIssueMeaning,
    isPrCause,
    isPrMeaning,
    type Projection,
} from "../workflow/index.js";
import {
    MANAGED_COMMENT_KINDS,
    type DatedCause,
    type IdempotencyClass,
    type IntentCatalogue,
    type IntentOperation,
    type ItemRef,
    type RepositoryRef,
    type StructuredExplanation,
} from "./catalogue.js";
import { INTENT_OPERATIONS } from "./operations/index.js";
import type { TypedDeclaration } from "./declaration.js";

// ─── Intents ─────────────────────────────────────────────────────────

/**
 * What a capability says ONCE about a clock-triggered destructive act
 * (`design/guides/grace.md` §1), and the whole of what it says.
 *
 * The platform owns WHEN — it posts the warning on first sight, records it,
 * refuses the act until the grace has run with no qualifying activity, and
 * posts the notice after the act lands. The capability owns WHAT: the two
 * bodies are its own voice with the date already rendered, because a
 * platform-authored sentence would flatten six designs into one template
 * (grace.md §5).
 *
 * `activityAt` is a FACT the capability read, not a judgement: the engine
 * compares it against the recorded warning, so a capability cannot decide for
 * itself that activity cancelled its own plan.
 */
export interface DestructiveGrace {
    /** The full grace, in days; at least `MIN_GRACE_DAYS`. */
    readonly days: number;
    /**
     * The discriminator the warning and the notice stand under, `""` by
     * default (D145).
     *
     * An act is one grace is one warning (grace.md §3), and an item can carry
     * more than one act of the same kind at once — an issue with two stale
     * assignees earns two releases. Their warnings are two comments only if
     * their topics differ, so a per-person act names the person here.
     */
    readonly topic?: string;
    /** The words posted on first sight — the date already rendered. */
    readonly warning: { readonly body: string };
    /** The words posted after the act lands. */
    readonly notice: { readonly body: string };
    /** What cancels the plan, in the warning's own words (grace.md). */
    readonly cancelledBy: string;
    /** How a maintainer reverses the act. */
    readonly reversesWith: string;
    /** The newest qualifying activity by the affected person, if the facts carry one. */
    readonly activityAt: Date | null;
}

/**
 * One request from a capability: what outcome it wants, for which item, and
 * the requested preconditions that authoritative projection data must verify.
 *
 * `idempotencyKey` is the effect's stable identity across redelivery, retry
 * and restart. It becomes the journal's `effect_id`, so two intents sharing a
 * key ARE one effect to the store
 * (`FINDING(runtime-idempotency-key-underived)`, D65).
 */
export interface Intent<K extends IntentOperation = IntentOperation> {
    readonly capability: string;
    readonly repository: RepositoryRef;
    readonly item: ItemRef;
    readonly operation: K;
    readonly claims: ClaimedFacts;
    readonly desired: IntentCatalogue[K];
    readonly cause: DatedCause;
    readonly evaluatedAt?: Date;
    readonly explanation: StructuredExplanation;
    readonly idempotencyKey: string;
    /**
     * The grace terms, for a clock-triggered destructive operation and for no
     * other (grace.md §1). `null` is the only value every other class may
     * carry, and the screen refuses both mistakes.
     */
    readonly grace: DestructiveGrace | null;
}

/** Discriminated over `operation`, so `desired` narrows with it. */
export type AnyIntent = { [K in IntentOperation]: Intent<K> }[IntentOperation];

/**
 * The one derivation. Capability, item, and operation identify WHAT; the
 * cause's timestamp identifies WHICH OCCASION, so a redelivery of the same
 * event yields the same key (the cause is a property of the event, not of
 * the delivery) while a genuinely new occasion yields a new one. The
 * desired payload is deliberately NOT included: a capability that
 * recomputes a slightly different comment body for the same occasion must
 * not thereby create a second comment.
 */
export function deriveIdempotencyKey(intent: {
    readonly capability: string;
    readonly repository: RepositoryRef;
    readonly item: ItemRef;
    readonly operation: IntentOperation;
    readonly cause: DatedCause;
}): string {
    // JSON, not a delimiter join: `cause` is free text, so no separator is
    // guaranteed absent, and a space-join collides "a b"+"c" with "a"+"b c"
    // — silently one effect. JSON encodes the boundaries (D65, D74).
    return JSON.stringify([
        intent.capability,
        intent.repository.owner,
        intent.repository.repo,
        intent.item.kind,
        String(intent.item.number),
        intent.operation,
        intent.cause.cause,
        intent.cause.observedAt.toISOString(),
    ]);
}

// ─── Runtime screens ─────────────────────────────────────────────────

/** Every way an intent can be refused before the safety engine sees it. */
export const INTENT_SCREEN_REFUSAL_CODES = [
    "malformedIntent",
    "foreignCapability",
    "undeclaredIntent",
    "invalidCause",
    "idempotencyKeyMismatch",
    "authoritativePositionUnavailable",
    "pauseNotCapabilityWritable",
    "meaningWrongEntity",
    "positionConflict",
    "transitionNotOnMap",
    "graceMismatch",
    "graceBelowFloor",
] as const;

/** One of `INTENT_SCREEN_REFUSAL_CODES`. */
export type IntentScreenRefusalCode = (typeof INTENT_SCREEN_REFUSAL_CODES)[number];

/** A screen's verdict: passed, or refused with a code and a sentence. */
export type IntentScreen =
    | { readonly ok: true }
    | {
          readonly ok: false;
          readonly code: IntentScreenRefusalCode;
          readonly reason: string;
      };

function own(value: unknown, key: string): unknown {
    if (typeof value !== "object" || value === null) return undefined;
    return Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined;
}

function stringList(value: unknown): readonly string[] | null {
    if (!Array.isArray(value)) return null;
    const copy = [...value];
    return copy.every((entry) => typeof entry === "string") ? copy : null;
}

function desiredOf(
    operation: IntentOperation,
    value: unknown,
): IntentCatalogue[IntentOperation] | null {
    if (operation === "postManagedComment") {
        const kind = own(value, "kind");
        const topic = own(value, "topic");
        const mention = own(value, "mention");
        const body = own(value, "body");
        if (
            !MANAGED_COMMENT_KINDS.includes(kind as never) ||
            (topic !== undefined && typeof topic !== "string") ||
            (mention !== undefined && typeof mention !== "string") ||
            typeof body !== "string"
        ) {
            return null;
        }
        return {
            kind: kind as (typeof MANAGED_COMMENT_KINDS)[number],
            ...(topic === undefined ? {} : { topic }),
            ...(mention === undefined ? {} : { mention }),
            body,
        };
    }
    if (operation === "applyMappedLabel") {
        const meaning = own(value, "meaning");
        const cause = own(value, "cause");
        return typeof meaning === "string" && typeof cause === "string"
            ? { meaning: meaning as MappableMeaning, cause: cause as never }
            : null;
    }
    const key =
        operation === "assign" || operation === "unassign" || operation === "releaseAssignment"
            ? "login"
            : "reason";
    const text = own(value, key);
    return typeof text === "string" && text.length > 0 ? ({ [key]: text } as never) : null;
}

function graceOf(value: unknown): DestructiveGrace | null | undefined {
    if (value === null || value === undefined) return null;
    const days = own(value, "days");
    const topic = own(value, "topic");
    const warning = own(value, "warning");
    const notice = own(value, "notice");
    const cancelledBy = own(value, "cancelledBy");
    const reversesWith = own(value, "reversesWith");
    const activityAt = own(value, "activityAt");
    const warningBody = own(warning, "body");
    const noticeBody = own(notice, "body");
    if (
        typeof days !== "number" ||
        !Number.isFinite(days) ||
        (topic !== undefined && typeof topic !== "string") ||
        typeof warningBody !== "string" ||
        typeof noticeBody !== "string" ||
        typeof cancelledBy !== "string" ||
        cancelledBy.length === 0 ||
        typeof reversesWith !== "string" ||
        reversesWith.length === 0 ||
        (activityAt !== null &&
            (!(activityAt instanceof Date) || !Number.isFinite(activityAt.getTime())))
    ) {
        return undefined;
    }
    return {
        days,
        ...(topic === undefined ? {} : { topic }),
        warning: { body: warningBody },
        notice: { body: noticeBody },
        cancelledBy,
        reversesWith,
        activityAt: activityAt === null ? null : new Date(activityAt.getTime()),
    };
}

export function readIntent(value: unknown): AnyIntent | null {
    try {
        const capability = own(value, "capability");
        const repository = own(value, "repository");
        const owner = own(repository, "owner");
        const repo = own(repository, "repo");
        const item = own(value, "item");
        const kind = own(item, "kind");
        const number = own(item, "number");
        const operation = own(value, "operation");
        const claims = own(value, "claims");
        const present = stringList(own(claims, "meaningsPresent"));
        const absent = stringList(own(claims, "meaningsAbsent"));
        const closed = own(claims, "closed");
        const cause = own(value, "cause");
        const causeName = own(cause, "cause");
        const observedAt = own(cause, "observedAt");
        const explanation = own(value, "explanation");
        const explanationCapability = own(explanation, "capability");
        const summary = own(explanation, "summary");
        const detail = stringList(own(explanation, "detail"));
        const idempotencyKey = own(value, "idempotencyKey");
        if (
            typeof capability !== "string" ||
            typeof owner !== "string" ||
            owner.length === 0 ||
            typeof repo !== "string" ||
            repo.length === 0 ||
            (kind !== "issue" && kind !== "pullRequest") ||
            typeof number !== "number" ||
            !Number.isSafeInteger(number) ||
            number < 1 ||
            typeof operation !== "string" ||
            !Object.hasOwn(INTENT_OPERATIONS, operation) ||
            present === null ||
            absent === null ||
            !present.every((entry) => MAPPABLE_MEANINGS.includes(entry as never)) ||
            !absent.every((entry) => MAPPABLE_MEANINGS.includes(entry as never)) ||
            (closed !== null && typeof closed !== "boolean") ||
            typeof causeName !== "string" ||
            !(observedAt instanceof Date) ||
            typeof explanationCapability !== "string" ||
            typeof summary !== "string" ||
            detail === null ||
            typeof idempotencyKey !== "string"
        ) {
            return null;
        }
        const desired = desiredOf(operation as IntentOperation, own(value, "desired"));
        const grace = graceOf(own(value, "grace"));
        if (desired === null || grace === undefined) return null;
        return {
            capability,
            repository: { owner, repo },
            item: { kind, number },
            operation,
            claims: {
                meaningsPresent: present as readonly MappableMeaning[],
                meaningsAbsent: absent as readonly MappableMeaning[],
                closed,
            },
            desired,
            cause: { cause: causeName, observedAt: new Date(observedAt.getTime()) },
            explanation: { capability: explanationCapability, summary, detail },
            idempotencyKey,
            grace,
        } as AnyIntent;
    } catch {
        return null;
    }
}

/**
 * Is the move this intent would make from the authoritative projected
 * position on the profile's map? Capability claims never supply `from`.
 */
function screenTransition(
    intent: Intent<"applyMappedLabel">,
    projection: Projection<MappableMeaning>,
): IntentScreen {
    if (projection.kind === "conflict") {
        return {
            ok: false,
            code: "positionConflict",
            reason: `the observed item holds ${projection.positions.join(" and ")}; a conflicted position has no edge to move along`,
        };
    }

    // `blocked` is a pause flag, not a position (D28); only a human may set
    // it — a capability that could would hold a veto over every other
    // capability (D79), and a freeze-by-label would bypass D54's gate.
    if (intent.desired.meaning === "blocked") {
        return {
            ok: false,
            code: "pauseNotCapabilityWritable",
            reason: "pausing an item withholds it from every capability, so only a human may set `blocked` (D79); a capability that must stop work needs the immediatePreventive gate (D54)",
        };
    }

    const wrongEntity = (meaning: string): IntentScreen => ({
        ok: false,
        code: "meaningWrongEntity",
        reason: `"${meaning}" is not ${intent.item.kind === "issue" ? "an issue" : "a pull request"} position`,
    });
    const offMap = (from: string | null, detail: string): IntentScreen => ({
        ok: false,
        code: "transitionNotOnMap",
        reason: `${from ?? "no position"} → ${intent.desired.meaning} for "${intent.desired.cause}" is not a documented edge (${detail})`,
    });
    const from = projection.state.meaning;

    if (intent.item.kind === "issue") {
        if (!isIssueMeaning(intent.desired.meaning)) return wrongEntity(intent.desired.meaning);
        if (from !== null && !isIssueMeaning(from)) return wrongEntity(from);
        if (!isIssueCause(intent.desired.cause)) {
            return offMap(from, "not an issue-flow cause");
        }
        const verdict = canTransitionIssue({
            from,
            to: intent.desired.meaning,
            cause: intent.desired.cause,
        });
        return verdict.allowed ? { ok: true } : offMap(from, verdict.code);
    }

    if (!isPrMeaning(intent.desired.meaning)) return wrongEntity(intent.desired.meaning);
    if (from !== null && !isPrMeaning(from)) return wrongEntity(from);
    if (!isPrCause(intent.desired.cause)) {
        return offMap(from, "not a pull-request-flow cause");
    }
    const verdict = canTransitionPr({
        from,
        to: intent.desired.meaning,
        cause: intent.desired.cause,
    });
    return verdict.allowed ? { ok: true } : offMap(from, verdict.code);
}

/**
 * Does the intent carry the grace terms its ACTION CLASS demands, and no
 * others (grace.md §1)?
 *
 * The class comes from `INTENT_OPERATIONS`, never from the intent, so a
 * capability cannot exempt itself by mislabelling what it is asking for. Both
 * mistakes are refused: a clock-triggered destructive act without terms would
 * reach the destructive door with nothing to warn in, and terms on any other
 * class would be words the platform promised to post and never will.
 *
 * The floor is named here as well as at the door. `graceBelowFloor` is the
 * destructive gate's own code and is reused rather than twinned: a maintainer
 * who reads it in a report should not have to learn which of two identical
 * refusals they are looking at.
 */
function screenGrace(intent: AnyIntent): IntentScreen {
    const destructive =
        INTENT_OPERATIONS[intent.operation].actionClassFloor === "clockTriggeredDestructive";
    // An absent field reads as `null`, the value the type spells for "no
    // terms": an intent built from `unknown` may simply not have the property,
    // and the safe reading of a missing promise is that none was made.
    const grace = intent.grace ?? null;
    if (destructive && grace === null) {
        return {
            ok: false,
            code: "graceMismatch",
            reason: `"${intent.operation}" is clock-triggered destructive, and such an intent must carry the grace terms the platform warns, waits and reports with (grace.md §1)`,
        };
    }
    if (!destructive && grace !== null) {
        return {
            ok: false,
            code: "graceMismatch",
            reason: `"${intent.operation}" is not clock-triggered destructive, so the grace terms it carries name a warning and a notice the platform would never post (grace.md §1)`,
        };
    }
    if (grace !== null && !(grace.days >= MIN_GRACE_DAYS)) {
        return {
            ok: false,
            code: "graceBelowFloor",
            reason: `grace period ${String(grace.days)}d is below the ${String(MIN_GRACE_DAYS)}d floor (grace.md)`,
        };
    }
    return { ok: true };
}

/**
 * The per-intent screen, run on everything `evaluate` returns. The typed
 * handle already makes an undeclared intent a compile error; this repeats
 * the check at runtime because a capability is ordinary code that can be
 * built from `unknown`, and the boundary must not depend on the far side
 * having been compiled honestly.
 */
export function screenIntent(
    value: unknown,
    declaration: TypedDeclaration,
    projection: Projection<MappableMeaning> | null,
): IntentScreen {
    const intent = readIntent(value);
    if (intent === null) {
        return {
            ok: false,
            code: "malformedIntent",
            reason: "the capability returned a malformed intent",
        };
    }
    if (intent.capability !== declaration.name) {
        return {
            ok: false,
            code: "foreignCapability",
            reason: `intent attributed to "${intent.capability}" was returned by "${declaration.name}"`,
        };
    }
    if (!declaration.intents.includes(intent.operation)) {
        return {
            ok: false,
            code: "undeclaredIntent",
            reason: `"${declaration.name}" did not declare intent "${intent.operation}"`,
        };
    }
    if (!Number.isFinite(intent.cause.observedAt.getTime())) {
        return {
            ok: false,
            code: "invalidCause",
            reason: "the intent's cause carries an invalid timestamp",
        };
    }
    // The key is the store's `effect_id` (D65), so a capability free to name
    // it could merge two effects into one or split a redelivery into two. It
    // is checked by RE-DERIVING it: the platform owns the identity, and the
    // factory's copy is an ergonomic, not an authority.
    //
    // AFTER the cause check, and only there: the derivation calls
    // `observedAt.toISOString()`, which throws on an invalid date.
    if (intent.idempotencyKey !== deriveIdempotencyKey(intent)) {
        return {
            ok: false,
            code: "idempotencyKeyMismatch",
            reason: "the intent's idempotency key is not the one this occasion derives",
        };
    }
    const grace = screenGrace(intent);
    if (!grace.ok) return grace;
    if (intent.operation === "applyMappedLabel") {
        if (projection === null) {
            return {
                ok: false,
                code: "authoritativePositionUnavailable",
                reason: "the authoritative current position is unavailable",
            };
        }
        return screenTransition(intent, projection);
    }
    return { ok: true };
}

/** The class any future writer must use — from the catalogue, never the intent. */
export function idempotencyOf(operation: IntentOperation): IdempotencyClass {
    return INTENT_OPERATIONS[operation].idempotencyClass;
}
