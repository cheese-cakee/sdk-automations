/**
 * What the ledger records, and what reading those records answers. Vocabulary only.
 * The reading itself is `fold.ts`; the statements that append are `ledger.ts`.
 */

import type { ItemRef, RepositoryRef } from "@hiero-hackers/automation-core";

/** What one fact says happened. Four close a call; two are the effect's own (D161). */
export type FactKind =
    "sent" | "unsent" | "landed" | "refused" | "abandoned" | "warned" | "reversed";

/** One appended row of an effect's history. Only retention removes one (D161). */
export interface Fact {
    readonly effectId: string;
    /** The call; 0 for an effect-level fact. */
    readonly seq: number;
    readonly kind: FactKind;
    readonly at: string;
    readonly revision: string;
    readonly capability: string;
    readonly repository: RepositoryRef;
    readonly item: ItemRef;
    /** The call's verb; null on an effect-level fact. */
    readonly verb: string | null;
    /** Only where the call names one. */
    readonly login: string | null;
    /** On `refused`, `unsent` and `abandoned`. */
    readonly code: string | null;
    readonly detail: string | null;
    /** The serialized call on `sent`, the warning snapshot on `warned`. */
    readonly payload: string | null;
}

/**
 * Where an effect stands, folded from its facts (D161).
 * `inconsistent` is history no applier could have written, and only a hand clears it.
 */
export type LedgerState =
    | { readonly kind: "neverStarted" }
    | {
          readonly kind: "open";
          readonly seq: number;
          readonly payload: string | null;
          readonly attempts: number;
      }
    | { readonly kind: "resumable"; readonly nextSeq: number }
    | {
          readonly kind: "settled";
          readonly how: "landed" | "refused" | "abandoned";
          readonly seq: number;
      }
    | { readonly kind: "inconsistent"; readonly detail: string };

/** One `sent` fact nothing has closed — the sweep's unit of work. */
export interface OpenSend {
    readonly effectId: string;
    /** The send's own column, so a recovery pass appends under the same repository. */
    readonly repository: RepositoryRef;
    readonly seq: number;
    readonly payload: string | null;
    readonly attempts: number;
    readonly at: string;
    readonly revision: string;
}

/** How many sends nothing has closed, and when the oldest of them was sent (D168). */
export interface OpenSendTally {
    readonly count: number;
    readonly oldest: string | null;
}

/** One completed call the platform made on an item — what GitHub's actor cannot say (D159). */
export interface LandedWrite {
    readonly verb: string | null;
    readonly login: string | null;
    readonly at: string;
}

/**
 * One recorded destructive warning, as the row holds it (grace.md §4).
 * Deliberately NOT a `DestructiveWarning`: the shell re-mints one through `createDestructiveWarning`, so bytes become authority only by passing back through it.
 */
export interface StoredWarning {
    readonly effectId: string;
    readonly warnedAt: string;
    readonly gracePeriodHours: number;
    readonly earliestActionAt: string;
    readonly cancelledBy: string;
    readonly reversesWith: string;
    readonly actionClass: string;
    readonly capability: string;
    readonly causeObservedAt: string;
    readonly cause: string;
    readonly item: string;
    readonly change: string;
}

/** How many warnings promise an action still ahead, and when the earliest is due (D168). */
export interface StandingWarnings {
    readonly count: number;
    readonly nextDue: string | null;
}

/** One pass's verdict on one item for one capability (D163). */
export interface Decision {
    readonly passId: string;
    readonly source: "webhook" | "sweep";
    readonly sourceId: string;
    readonly at: string;
    readonly repository: RepositoryRef;
    readonly item: ItemRef;
    readonly capability: string;
    readonly verdict: string;
    readonly code: string | null;
    readonly detail: string | null;
    /** The effect the verdict minted, where it minted one. */
    readonly effectId: string | null;
}

/** How many decisions one verdict took over a window (D168). */
export interface VerdictTally {
    readonly verdict: string;
    readonly count: number;
}
