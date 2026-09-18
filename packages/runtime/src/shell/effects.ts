/** The vocabulary the write path speaks: one call, its recorded bytes, and its outcome words. */

import type {
    IntentOperation,
    ItemRef,
    ManagedCommentKind,
    RecordOnlyCode,
    SafetyRefusalCode,
} from "@hiero-hackers/automation-core";

// ─── The words an outcome is reported in ─────────────────────────────

/**
 * What one apply pass made of one effect.
 * `refused` closes the row, `writeUnsupported` excepted; `retryLater` and `unknown` leave it open.
 */
export const EFFECT_OUTCOMES = ["applied", "already", "refused", "retryLater", "unknown"] as const;

export type EffectOutcomeName = (typeof EFFECT_OUTCOMES)[number];

/** Why an outcome is what it is, for everything that happens BELOW a verdict. */
export const EFFECT_CODES = [
    "leaseHeld",
    "sweepRequestCap",
    "sweepWriteCap",
    "rowUnreadable",
    "ledgerInconsistent",
    "configurationChanged",
    "identityMissing",
    "labelUnmapped",
    "itemUnreadable",
    "externalsUnavailable",
    "writeConflict",
    "writeForbidden",
    "writeRetryLater",
    "writeUnknown",
    "writeUnsupported",
    "postconditionUnconfirmed",
] as const;

export type EffectCode = (typeof EFFECT_CODES)[number];

/** Every code an outcome may carry: a verdict's, or one of the applier's own. */
export type EffectOutcomeCode = SafetyRefusalCode | RecordOnlyCode | EffectCode;

/** One effect's fate; `code` is `null` only when nothing refused and nothing was ambiguous. */
export interface EffectOutcome {
    readonly effectId: string;
    readonly capability: string;
    readonly operation: IntentOperation;
    readonly item: ItemRef;
    readonly outcome: EffectOutcomeName;
    readonly code: EffectOutcomeCode | null;
    readonly detail: string | null;
}

// ─── What one call is ────────────────────────────────────────────────

/** One GitHub call, named by the postcondition it establishes, not the verb it uses. */
export type Call =
    | {
          readonly verb: "postComment";
          readonly kind: ManagedCommentKind;
          readonly body: string;
      }
    | {
          readonly verb: "defineLabel";
          readonly label: string;
          readonly color: string;
          readonly description: string;
      }
    | { readonly verb: "addLabel"; readonly label: string }
    | { readonly verb: "removeLabel"; readonly label: string }
    | { readonly verb: "assign"; readonly login: string }
    | { readonly verb: "unassign"; readonly login: string }
    | { readonly verb: "releaseAssignment"; readonly login: string }
    | { readonly verb: "closePullRequest"; readonly reason: string }
    | { readonly verb: "lockIssue"; readonly reason: string }
    | { readonly verb: "unlockIssue"; readonly reason: string };

/** One call as its `sent` fact spells it — the fact's `payload`, parsed. */
export interface JournaledCall {
    readonly capability: string;
    readonly item: ItemRef;
    readonly call: Call;
}

// ─── The plan ────────────────────────────────────────────────────────

/** The calls one effect takes, or the reason it takes none. */
export type Plan =
    | { readonly ok: true; readonly calls: readonly Call[] }
    | { readonly ok: false; readonly code: EffectCode; readonly detail: string };

/**
 * The marker, then the capability's content, separated by a blank line.
 * The marker must be first: a marker anywhere else is not even a claim (D125).
 */
export function renderManagedBody(marker: string, body: string): string {
    return `${marker}\n\n${body}`;
}
