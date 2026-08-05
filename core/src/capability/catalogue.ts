/**
 * The closed platform vocabularies — every observation a capability may
 * receive, every resolver it may ask, every intent it may express — plus the
 * facts the PLATFORM owns about each operation.
 *
 * D61: a capability chooses from these; it cannot extend them. The
 * alternative is unimplementable at the far end, because the adapter would
 * need an executor for a type it has never seen. Isolation (P3) falls out:
 * capabilities that share no vocabulary have nothing to call each other
 * through.
 */

import type { IdempotencyClass, PermissionGrant } from "./declaration.js";
import type { MappableMeaning } from "../config/index.js";
import type { ActionClass } from "../safety/index.js";
import type { EntityKind } from "../workflow/index.js";

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
export const ACTION_CLASS_RANK: { readonly [K in ActionClass]: number } = {
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
