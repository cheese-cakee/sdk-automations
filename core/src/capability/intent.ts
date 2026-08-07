/**
 * What a capability asks for, and the screens every request passes.
 *
 * An intent describes a desired OUTCOME, not an API call — the translation
 * into calls is the executor's planner, deliberately outside `core/`.
 */

import type { ActionClass, ClaimedFacts } from "../safety/index.js";
import type { IdempotencyClass } from "./catalogue.js";
import type { MappableMeaning } from "../config/index.js";
import {
    canTransitionIssue,
    canTransitionPr,
    isIssueCause,
    isIssueMeaning,
    isPrCause,
    isPrMeaning,
} from "../workflow/index.js";
import {
    ACTION_CLASS_RANK,
    INTENT_OPERATIONS,
    type DatedCause,
    type IntentCatalogue,
    type IntentOperation,
    type ItemRef,
    type RepositoryRef,
    type StructuredExplanation,
} from "./catalogue.js";
import type { TypedDeclaration } from "./declaration.js";

// ─── Intents ─────────────────────────────────────────────────────────

/**
 * contract.md §3 `expected`: the facts the capability believes hold. Now an
 * alias of safety's `ClaimedFacts` (D92 phase 4) — the claim and the
 * derivation that checks it share one definition, in the checker's module.
 */
export type ExpectedFacts = ClaimedFacts;

/**
 * The warning record a destructive intent must carry — required when the
 * action class is `clockTriggeredDestructive`, absent otherwise, and the
 * reverse check is the dangerous one: a warning on a non-destructive intent
 * reads as a grace period no gate will consult
 * (`FINDING(runtime-destructive-intent-has-no-warning)`, D64).
 *
 * The warned CAUSE is carried separately because D60's branded warning cannot
 * cross the store: rebuilding it from the current request would make the
 * snapshot check compare a value with itself
 * (`FINDING(runtime-warning-cannot-cross-the-store)`, D72).
 */
export interface DestructiveDetail {
    readonly warnedAt: Date;
    readonly gracePeriodDays: number;
    readonly earliestActionAt: Date;
    readonly cancelledBy: string;
    readonly reversesWith: string;
    readonly qualifyingActivitySinceWarning: boolean;
    readonly warnedCause: string;
    readonly warnedCauseObservedAt: Date;
}

export interface Intent<K extends IntentOperation = IntentOperation> {
    readonly capability: string;
    readonly repository: RepositoryRef;
    readonly item: ItemRef;
    readonly operation: K;
    /** At or above `INTENT_OPERATIONS[operation].actionClassFloor`. */
    readonly actionClass: ActionClass;
    /** Required when `actionClass` is `clockTriggeredDestructive`, else absent. */
    readonly destructive?: DestructiveDetail;
    readonly expected: ExpectedFacts;
    readonly desired: IntentCatalogue[K];
    readonly cause: DatedCause;
    readonly explanation: StructuredExplanation;
        /**
     * The effect's stable identity across redelivery, retry and restart — it
     * becomes the journal's `effect_id`, so two intents sharing a key ARE one
     * effect to the store (`FINDING(runtime-idempotency-key-underived)`, D65).
     */
    readonly idempotencyKey: string;
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
    /**
     * JSON rather than a delimiter join. Every field except `cause` is
     * constrained, but `cause` is capability-authored free text, so no
     * printable separator is guaranteed absent from it — and a plain
     * space join is actively wrong: capability "a b" with repo "c"
     * produces the same key as capability "a" with repo "b c",
     * silently making two effects one. JSON encodes the boundaries
     * instead of hoping for them, and unlike a control-character
     * delimiter it leaves the file readable to grep and diff tools.
     */
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

/**
 * Is the move this intent would make on the profile's map?
 *
 * D29 says capabilities move along documented edges and humans may land
 * anywhere — and nothing enforced the first half. The transition tables were
 * exhaustively tested, checked against the design document, and corrected
 * three times by D48's audit, with ZERO callers: a capability could put
 * `readyToMerge`, a pull-request meaning, on an issue and both the screen and
 * the safety engine would pass it (D78).
 *
 * Self-contained on purpose. Everything needed is already on the intent, and
 * the claimed `from` is the same `expected` safety rechecks as
 * `preconditionHolds`.
 */
function screenTransition(intent: Intent<"applyMappedLabel">): IntentScreen {
    /**
     * `blocked` is an orthogonal PAUSE FLAG, not a position (D28): an item
     * keeps where it is while blocked, so applying it moves nothing and there
     * is no edge to check. It is refused anyway, and for a different reason
     * than a wrong entity — the distinction matters, because a maintainer
     * reading a refusal deserves the true one.
     *
     * D79: pausing is the ONE write whose blast radius is other capabilities.
     * `itemBlocked` is not a rule about the item, it is a rule about every
     * capability's access to it — so a capability that could set it would
     * hold a veto over the others, through shared state and without calling
     * them. That is the coupling P3 forbids, in its least visible form: the
     * vetoed capability sees `itemBlocked` and cannot learn who caused it.
     *
     * It is also the consistent reading. "Detect a problem, freeze the item"
     * is an `immediatePreventive` action, which D54 already refuses outright
     * pending an explanation-and-reversal gate. Letting a capability reach the
     * same outcome by writing a label would be a hole in D54, and the repair
     * is to close the label path rather than widen the gate.
     */
    if (intent.desired.meaning === "blocked") {
        return {
            ok: false,
            code: "pauseNotCapabilityWritable",
            reason: "pausing an item withholds it from every capability, so only a human may set `blocked` (D79); a capability that must stop work needs the immediatePreventive gate (D54)",
        };
    }

    /**
     * From here the two flows are handled symmetrically, and the predicates
     * carry the narrowing the compiler needs — before D90 this crossing was
     * six `as`-casts, each safe only because of a guard the type system
     * could not see. Held meanings filter to own-flow only: a stray
     * cross-entity label is noise to preserve (D35), not the position being
     * moved away from; more than one own-flow position is a conflict
     * `observe.ts` refuses to project, and treating it as "no position"
     * would silently check the wrong edge.
     */
    const wrongEntity = (): IntentScreen => ({
        ok: false,
        code: "meaningWrongEntity",
        reason: `"${intent.desired.meaning}" is not ${intent.item.kind === "issue" ? "an issue" : "a pull request"} position`,
    });
    const conflicted = (held: readonly string[]): IntentScreen => ({
        ok: false,
        code: "positionConflict",
        reason: `the item is claimed to hold ${held.join(" and ")}; a conflicted position has no edge to move along`,
    });
    const offMap = (from: string | null, detail: string): IntentScreen => ({
        ok: false,
        code: "transitionNotOnMap",
        reason: `${from ?? "no position"} → ${intent.desired.meaning} for "${intent.desired.cause}" is not a documented edge (${detail})`,
    });

    if (intent.item.kind === "issue") {
        if (!isIssueMeaning(intent.desired.meaning)) return wrongEntity();
        const held = intent.expected.meaningsPresent.filter(isIssueMeaning);
        if (held.length > 1) return conflicted(held);
        const from = held.length === 1 ? held[0]! : null;
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

    if (!isPrMeaning(intent.desired.meaning)) return wrongEntity();
    const held = intent.expected.meaningsPresent.filter(isPrMeaning);
    if (held.length > 1) return conflicted(held);
    const from = held.length === 1 ? held[0]! : null;
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

export const INTENT_SCREEN_REFUSAL_CODES = [
    "foreignCapability",
    "undeclaredIntent",
    "actionClassBelowFloor",
    "invalidCause",
    "destructiveWithoutWarning",
    "warningWithoutDestructive",
    "pauseNotCapabilityWritable",
    "meaningWrongEntity",
    "positionConflict",
    "transitionNotOnMap",
] as const;

export type IntentScreenRefusalCode =
    (typeof INTENT_SCREEN_REFUSAL_CODES)[number];

export type IntentScreen =
    | { readonly ok: true }
    | {
          readonly ok: false;
          readonly code: IntentScreenRefusalCode;
          readonly reason: string;
      };

/**
 * The per-intent screen, run on everything `evaluate` returns. The typed
 * handle already makes an undeclared intent a compile error; this repeats
 * the check at runtime because a capability is ordinary code that can be
 * built from `unknown`, and the boundary must not depend on the far side
 * having been compiled honestly.
 */
export function screenIntent(
    intent: AnyIntent,
    declaration: TypedDeclaration,
): IntentScreen {
    if (intent.capability !== declaration.name) {
        return {
            ok: false,
            code: "foreignCapability",
            reason: `intent attributed to "${intent.capability}" was returned by "${declaration.name}"`,
        };
    }
    const declared = declaration.intents.find(
        (i) => i.name === intent.operation,
    );
    if (declared === undefined) {
        return {
            ok: false,
            code: "undeclaredIntent",
            reason: `"${declaration.name}" did not declare intent "${intent.operation}"`,
        };
    }
    const facts = INTENT_OPERATIONS[intent.operation];
    if (ACTION_CLASS_RANK[intent.actionClass] < ACTION_CLASS_RANK[facts.actionClassFloor]) {
        return {
            ok: false,
            code: "actionClassBelowFloor",
            reason: `"${intent.operation}" declared as "${intent.actionClass}" is below the "${facts.actionClassFloor}" floor (FINDING(runtime-action-class-floor))`,
        };
    }
    if (!Number.isFinite(intent.cause.observedAt.getTime())) {
        return {
            ok: false,
            code: "invalidCause",
            reason: "the intent's cause carries an invalid timestamp",
        };
    }
    /**
     * Both directions are errors. A destructive intent with no warning
     * would reach `evaluateDestructive` and be refused there anyway; a
     * NON-destructive intent carrying a warning is the dangerous one — it
     * reads as a grace period that no gate will ever check, because
     * `evaluateWrite` does not look at the field.
     */
    const destructive = intent.actionClass === "clockTriggeredDestructive";
    if (destructive && intent.destructive === undefined) {
        return {
            ok: false,
            code: "destructiveWithoutWarning",
            reason: `"${intent.operation}" is clock-triggered destructive but carries no warning record (safety.md §3)`,
        };
    }
    if (!destructive && intent.destructive !== undefined) {
        return {
            ok: false,
            code: "warningWithoutDestructive",
            reason: `"${intent.operation}" carries a warning record but is declared "${intent.actionClass}" — no gate would check it`,
        };
    }
    if (intent.operation === "applyMappedLabel") {
        return screenTransition(intent);
    }
    return { ok: true };
}

/** The class the executor must use — from the catalogue, never the intent. */
export function idempotencyOf(operation: IntentOperation): IdempotencyClass {
    return INTENT_OPERATIONS[operation].idempotencyClass;
}
