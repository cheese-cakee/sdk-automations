/**
 * The capability runtime boundary — `design/modules/contract.md` §2, §3
 * and §6 as types. The declaration layer (`contract.ts`) says what a
 * capability *is*; this module says how the platform *calls* it.
 *
 * Written as parallel-track probe work (2026-08-03) while the stage-two
 * ranking is still open, on D32's precedent: capability *choice* waits on
 * maintainer data, but the capability *boundary* is capability-independent
 * — nothing below names a capability. Still pure: `evaluate` returns a
 * promise as a TYPE, but no function here performs I/O.
 *
 * The central design commitment, and the one contract.md §9 left open
 * ("the project must select the first concrete observation, resolver, and
 * intent types"): observations, resolvers, and intents are **closed
 * platform vocabularies**, declared here as catalogues. A capability
 * chooses from them; it cannot extend them. The alternative — each
 * capability defining its own intent shapes — is unimplementable at the
 * far end, because the adapter would need an executor for a type it has
 * never seen. Isolation (P3) is a consequence: capabilities that share no
 * vocabulary have nothing to call each other through.
 */

import type {
    CapabilityDeclaration,
    IdempotencyClass,
    IntentDeclaration,
    PermissionGrant,
} from "./contract.js";
import type { MappableMeaning, RepositoryConfig } from "./config.js";
import type { ActionClass } from "./safety.js";
import type { EntityKind } from "./taxonomy.js";

// ─── References and explanations ─────────────────────────────────────

export interface RepositoryRef {
    readonly owner: string;
    readonly repo: string;
}

/** GitHub numbers issues and pull requests in one sequence per repository. */
export interface ItemRef {
    readonly kind: EntityKind;
    readonly number: number;
}

/**
 * safety.md's "explains each action in a comment" as structure rather
 * than prose: `summary` is the human sentence, `detail` the supporting
 * facts, `capability` the attribution every managed write owes. Kept
 * structured so the managed comment, the dry-run report, and the operator
 * surface render the SAME explanation instead of three drifting strings.
 */
export interface StructuredExplanation {
    readonly capability: string;
    readonly summary: string;
    readonly detail: readonly string[];
}

/** contract.md §3 — a cause is always dated (safety.md rule 5). */
export interface DatedCause {
    readonly cause: string;
    readonly observedAt: Date;
}

// ─── The observation catalogue ───────────────────────────────────────

/**
 * What the platform hands a capability. Every payload carries `kind`, so
 * a capability declaring several observations receives a discriminated
 * union rather than an intersection it must narrow by hand.
 *
 * Payloads are NORMALIZED facts (contract.md §2: "the platform normalizes
 * all external facts before evaluation"). No webhook payload, no Octokit
 * object, no raw label strings — the projection has already run, so a
 * capability sees positions and meanings, never the repository's words
 * for them.
 */
export interface ObservationCatalogue {
    readonly issueUpdated: {
        readonly kind: "issueUpdated";
        readonly repository: RepositoryRef;
        readonly item: ItemRef;
        /** The projection from `observe.ts`; `null` when it conflicted. */
        readonly meanings: readonly MappableMeaning[];
        readonly blocked: boolean;
        readonly closed: boolean;
        readonly observedAt: Date;
    };
    readonly pullRequestUpdated: {
        readonly kind: "pullRequestUpdated";
        readonly repository: RepositoryRef;
        readonly item: ItemRef;
        readonly meanings: readonly MappableMeaning[];
        readonly blocked: boolean;
        readonly closed: boolean;
        readonly merged: boolean;
        readonly observedAt: Date;
    };
    readonly staleItemsDue: {
        readonly kind: "staleItemsDue";
        readonly repository: RepositoryRef;
        readonly items: readonly {
            readonly item: ItemRef;
            readonly assignee: string | null;
            readonly lastHumanActivityAt: Date | null;
            /** A recorded warning for this item, `null` if none yet. */
            readonly warnedAt: Date | null;
        }[];
        readonly observedAt: Date;
    };
}

export type ObservationName = keyof ObservationCatalogue & string;

// ─── The resolver catalogue ──────────────────────────────────────────

/** resolvers.md §2, narrowed to the resolvers the probes exercise. */
export interface ResolverCatalogue {
    readonly linkedIssues: {
        readonly input: { readonly item: ItemRef };
        readonly output: readonly ItemRef[];
    };
    readonly isAutomationActor: {
        readonly input: { readonly login: string };
        readonly output: boolean;
    };
}

export type ResolverName = keyof ResolverCatalogue & string;
export type ResolverInput<Q extends ResolverName> = ResolverCatalogue[Q]["input"];
export type ResolverOutput<Q extends ResolverName> = ResolverCatalogue[Q]["output"];

/**
 * resolvers.md §6, as a type a capability cannot ignore: an empty answer
 * and an answer that could not be determined are different values, not
 * both `[]`. A capability must never read "the API failed" as "no linked
 * issue exists" — the union makes the distinction unavoidable rather than
 * documented.
 */
export type ResolverAnswer<T> =
    | { readonly ok: true; readonly value: T }
    | {
          readonly ok: false;
          readonly reason:
              | "noPermission"
              | "rateLimited"
              | "unavailable"
              | "notConfigured";
          readonly detail: string;
      };

// ─── The intent catalogue ────────────────────────────────────────────

/** The desired-outcome payload per operation (contract.md §3 `desired`). */
export interface IntentCatalogue {
    readonly postManagedComment: {
        readonly marker: string;
        readonly body: string;
    };
    readonly applyMappedLabel: { readonly meaning: MappableMeaning };
    readonly removeMappedLabel: { readonly meaning: MappableMeaning };
    readonly unassign: { readonly login: string };
}

export type IntentOperation = keyof IntentCatalogue & string;

/**
 * The facts the PLATFORM owns about an operation — never the capability.
 *
 * FINDING(runtime-idempotency-declared-not-checked): `contract.ts`
 * accepts any `idempotencyClass` on any intent name, so a capability
 * could declare `postManagedComment` as `idempotent`. The executor trusts
 * that class to choose its retry rule, so the declaration would send it
 * down the blind-retry path and reproduce experiment 6.5's demonstrated
 * comment duplication — the exact failure the class exists to prevent. A
 * per-capability field cannot be the authority on a per-endpoint fact.
 * The catalogue is now the authority and `checkAgainstCatalogue` rejects
 * a declaration that disagrees; the declared field survives as a
 * REDUNDANT statement that must match, which is what makes the mismatch
 * catchable at registry build instead of at the first lost response.
 *
 * FINDING(runtime-action-class-floor): safety.md's `ActionClass` is not
 * declared anywhere in the capability contract, so `evaluateWrite` — which
 * requires one — had no supplier. It cannot be purely per-operation
 * either: `unassign` is a `reversibleStateChange` when a human asks and a
 * `clockTriggeredDestructive` when a clock does, and only the capability
 * knows which. The rule is therefore a FLOOR: the catalogue names the
 * minimum risk class, the intent may declare a stricter one, and a laxer
 * one is refused. A capability can be more careful than the platform
 * requires; it can never be less.
 */
export interface OperationFacts {
    readonly idempotencyClass: IdempotencyClass;
    readonly actionClassFloor: ActionClass;
    readonly permission: PermissionGrant;
}

/** Increasing risk — safety.md §1's order, as a comparable rank. */
const ACTION_CLASS_RANK: { readonly [K in ActionClass]: number } = {
    observation: 0,
    humanFacingOutput: 1,
    reversibleStateChange: 2,
    clockTriggeredDestructive: 3,
    immediatePreventive: 4,
};

export const INTENT_OPERATIONS: {
    readonly [K in IntentOperation]: OperationFacts;
} = {
    // 6.5: comment creation duplicates on a blind retry. Not negotiable.
    postManagedComment: {
        idempotencyClass: "nonIdempotent",
        actionClassFloor: "humanFacingOutput",
        permission: "issues:write",
    },
    applyMappedLabel: {
        idempotencyClass: "idempotent",
        actionClassFloor: "reversibleStateChange",
        permission: "issues:write",
    },
    removeMappedLabel: {
        idempotencyClass: "idempotent",
        actionClassFloor: "reversibleStateChange",
        permission: "issues:write",
    },
    unassign: {
        idempotencyClass: "idempotent",
        actionClassFloor: "reversibleStateChange",
        permission: "issues:write",
    },
};

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
    return [
        intent.capability,
        intent.repository.owner,
        intent.repository.repo,
        intent.item.kind,
        String(intent.item.number),
        intent.operation,
        intent.cause.cause,
        intent.cause.observedAt.toISOString(),
    ].join(" ");
}

// ─── Typed declarations ──────────────────────────────────────────────

/**
 * A declaration whose names are catalogue keys. `CapabilityDeclaration`
 * keeps `readonly string[]` because configuration validation and operator
 * reporting only need names; the runtime boundary needs the payload types
 * those names stand for, which only a key-constrained declaration gives.
 */
export interface TypedDeclaration extends CapabilityDeclaration {
    readonly observations: readonly ObservationName[];
    readonly resolvers: readonly ResolverName[];
    readonly intents: readonly (IntentDeclaration & {
        readonly name: IntentOperation;
    })[];
}

/**
 * Identity at runtime; the point is the `const` type parameter, which
 * pins `observations`, `resolvers`, and `intents` as literal tuples. A
 * declaration written as a plain object widens them to `string[]`, and
 * every projection below then degrades to "any name" — losing exactly the
 * isolation the boundary exists to enforce. Declare capabilities through
 * this function, never by annotating them `: TypedDeclaration`.
 */
export function declareCapability<const D extends TypedDeclaration>(d: D): D {
    return d;
}

export type ObservationFor<D extends TypedDeclaration> =
    ObservationCatalogue[D["observations"][number]];

export type IntentFor<D extends TypedDeclaration> = Extract<
    AnyIntent,
    { operation: D["intents"][number]["name"] }
>;

/**
 * contract.md §6 — the projection a capability sees. Four deliberate
 * omissions, each of which would hand a capability a decision that is not
 * its own:
 *
 * - no `mode`: dry-run and active are policy. A capability that branched
 *   on mode would be deciding whether to write, which is rule 10's job.
 * - no `enabled`: a disabled capability is never evaluated (§8), so the
 *   field could only ever read `true` — and a capability that could read
 *   it could try to act while off.
 * - no other capability's block (§6, P3).
 * - **no label strings.** §6 says a capability "refers to internal
 *   meanings rather than repository label strings", so the view reports
 *   WHICH meanings a repository has mapped, never what it calls them.
 *   Passing `mappings.labels` through would have satisfied the types and
 *   quietly broken the rule; a capability that never sees a label string
 *   cannot hard-code one.
 */
export interface CapabilityView<D extends TypedDeclaration> {
    readonly settings: {
        readonly [K in D["configKeys"][number]]?: unknown;
    };
    readonly mappedMeanings: readonly MappableMeaning[];
}

/**
 * Build that view. Undeclared settings keys are dropped rather than
 * rejected — the capability's own schema owns its block (§6), and this
 * function's job is the isolation cut, not validation.
 */
export function projectCapabilityView<const D extends TypedDeclaration>(
    declaration: D,
    config: RepositoryConfig,
): CapabilityView<D> {
    const block = config.capabilities[declaration.name];
    const settings: Record<string, unknown> = Object.create(null);
    for (const key of declaration.configKeys) {
        if (block !== undefined && Object.hasOwn(block.settings, key)) {
            settings[key] = block.settings[key];
        }
    }
    const mapped = (
        Object.keys(config.mappings.labels) as MappableMeaning[]
    ).filter((m) => config.mappings.labels[m] !== undefined);
    return {
        settings: settings as CapabilityView<D>["settings"],
        mappedMeanings: mapped,
    };
}

// ─── The handle and the capability ───────────────────────────────────

/**
 * contract.md §2. `Q extends D["resolvers"][number]` is the isolation
 * rule as a type: an undeclared resolver does not compile. It does not
 * expose Octokit, HTTP, a raw payload, arbitrary comments, or another
 * capability — the shape of what is absent is the guarantee.
 */
export interface PlatformHandle<D extends TypedDeclaration> {
    resolve<Q extends D["resolvers"][number] & ResolverName>(
        query: Q,
        input: ResolverInput<Q>,
    ): Promise<ResolverAnswer<ResolverOutput<Q>>>;
    explain(explanation: StructuredExplanation): void;
}

export interface Capability<D extends TypedDeclaration> {
    readonly declaration: D;
    /**
     * Pure with respect to the repository: a capability decides, it never
     * writes. Everything it returns is a REQUEST that the policy layer
     * may refuse — which is why `evaluate` cannot report success, and why
     * `EffectResult` (contract.md §4) is never handed back to it.
     */
    evaluate(
        observation: ObservationFor<D>,
        config: CapabilityView<D>,
        platform: PlatformHandle<D>,
    ): Promise<readonly IntentFor<D>[]>;
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
