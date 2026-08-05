/**
 * What a capability asks for, and the screens every request passes.
 *
 * An intent describes a desired OUTCOME, not an API call — the translation
 * into calls is the executor's planner, deliberately outside `core/`.
 */

import type { ActionClass } from "../safety/index.js";
import type { IdempotencyClass } from "./catalogue.js";
import type { MappableMeaning } from "../config/index.js";
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
 * contract.md §3 `expected`: the facts the capability believes hold. The
 * policy layer rechecks them immediately before the write and refuses on
 * mismatch (`preconditionStale`), which is how a capability's stale view
 * of the world stops being a write.
 */
export interface ExpectedFacts {
    readonly meaningsPresent: readonly MappableMeaning[];
    readonly meaningsAbsent: readonly MappableMeaning[];
    /** `null` when the capability does not care about open/closed. */
    readonly closed: boolean | null;
}

/**
 * Required when the action class is `clockTriggeredDestructive`, absent
 * otherwise — and the reverse check is the dangerous one: a warning on a
 * non-destructive intent reads as a grace period no gate will consult
 * (`FINDING(runtime-destructive-intent-has-no-warning)`, D64).
 */
export interface DestructiveDetail {
    readonly warnedAt: Date;
    readonly gracePeriodDays: number;
    readonly earliestActionAt: Date;
    readonly cancelledBy: string;
    readonly reversesWith: string;
    readonly qualifyingActivitySinceWarning: boolean;
    /**
 * The warning record a destructive intent must carry.
 *
 * `evaluateDestructive` refuses without one, and contract.md §3's intent had no
 * field for it, so a destructive intent could never pass its own gate
 * (`FINDING(runtime-destructive-intent-has-no-warning)`, D64).
 *
 * The warned CAUSE is carried separately because D60's branded warning cannot
 * cross the store: rebuilding it from the current request would make the
 * snapshot check compare a value with itself
 * (`FINDING(runtime-warning-cannot-cross-the-store)`, D72).
 */
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
 * The catalogue check that `validateDeclaration` cannot perform, because
 * `contract.ts` knows nothing about operations. Run at registry build:
 * both findings above are caught here, before any effect exists.
 */
export function checkAgainstCatalogue(d: TypedDeclaration): readonly string[] {
    const errors: string[] = [];
    const at = `capability "${d.name}"`;
    for (const intent of d.intents) {
        const facts = INTENT_OPERATIONS[intent.name];
        if (facts.idempotencyClass !== intent.idempotencyClass) {
            errors.push(
                `${at}: intent "${intent.name}" declares idempotencyClass "${intent.idempotencyClass}" but the operation is "${facts.idempotencyClass}" — ` +
                    `the platform owns this fact (FINDING(runtime-idempotency-declared-not-checked))`,
            );
        }
        if (!intent.requiredPermissions.includes(facts.permission)) {
            errors.push(
                `${at}: intent "${intent.name}" must require "${facts.permission}"`,
            );
        }
    }
    return errors;
}

export type IntentScreen =
    | { readonly ok: true }
    | { readonly ok: false; readonly code: string; readonly reason: string };

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
    return { ok: true };
}

/** The class the executor must use — from the catalogue, never the intent. */
export function idempotencyOf(operation: IntentOperation): IdempotencyClass {
    return INTENT_OPERATIONS[operation].idempotencyClass;
}
