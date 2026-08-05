/**
 * What a capability asks for, and the screens every request passes.
 *
 * An intent describes a desired OUTCOME, not an API call — the translation
 * into calls is the executor's planner, deliberately outside `core/`.
 */

import type { ActionClass } from "../safety/index.js";
import type { IdempotencyClass } from "./declaration.js";
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
import type { TypedDeclaration } from "./boundary.js";

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
 * The warning record a destructive intent must carry.
 *
 * FINDING(runtime-destructive-intent-has-no-warning): `evaluateDestructive`
 * requires a `DestructiveWarning` and a qualifying-activity flag, and
 * refuses without one (`noWarning`) — but contract.md §3's intent has no
 * field for either, so an intent alone could never pass the destructive
 * gate. The safety engine and the capability contract were written against
 * each other and did not meet. The warning belongs on the intent rather
 * than being looked up by the planner: the capability is what decides an
 * item is stale, so it is what must show its warning, and a planner that
 * fetched the record itself could pair a warning with an intent that was
 * never about it.
 */
export interface DestructiveDetail {
    readonly warnedAt: Date;
    readonly gracePeriodDays: number;
    readonly earliestActionAt: Date;
    readonly cancelledBy: string;
    readonly reversesWith: string;
    readonly qualifyingActivitySinceWarning: boolean;
    /**
     * The causal observation the warning actually authorized, restated
     * so it can be compared against the intent's current cause.
     *
     * FINDING(runtime-warning-cannot-cross-the-store): D60 makes a
     * `DestructiveWarning` a branded object that only
     * `createDestructiveWarning` can build — a genuine within-process
     * guarantee, and one that cannot survive the journey a warning
     * actually makes. A warning is issued in one process run and acted
     * on days later, across restarts, so it must be persisted as plain
     * data and rebuilt; the brand is a runtime symbol and does not
     * serialize. Rebuilding it from the CURRENT request would satisfy
     * every type and make `warningMatchesRequest` tautological — a
     * safety check that can never fail, which is worse than none. These
     * two fields are therefore the stored warned cause, and the planner
     * rebuilds the warning from them, so the comparison has something
     * real to disagree with.
     *
     * The seam narrows D60's check to the causal fields: item and change
     * both derive from the same intent at both ends, so a capability
     * cannot make them diverge. The cause is the one part it can get
     * wrong, and getting it wrong is exactly the reuse D60 forbids.
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
     * The effect's stable identity across redelivery, retry, and restart
     * — it becomes the journal's `effect_id`, so two intents sharing a key
     * ARE one effect to the store.
     *
     * FINDING(runtime-idempotency-key-underived): contract.md §3 requires
     * this field but never says what it is derived from, while the store's
     * primary key silently depends on the answer. Two distinct intents
     * that collide look like one already-done effect and the second is
     * never performed; the same intent keyed differently on redelivery
     * duplicates. `deriveIdempotencyKey` gives one derivation so the
     * question is answered in one place rather than per capability.
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
