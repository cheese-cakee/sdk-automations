/**
 * The vocabulary the write path speaks: what one call IS, what its journal
 * row holds, and the words an outcome is reported in.
 *
 * Pure, and per-verb knowledge lives elsewhere on purpose. `operations/` is
 * where each operation's own module plans, spells, reads, sends and proves its
 * calls; `apply.ts` is the choreography that drives a plan and owns every I/O
 * seam. Both speak this file, and this file imports neither.
 *
 * The row format is the load-bearing part. The storage decision's recovery
 * loop resends FROM THE ROW, never by re-deciding, so a row must carry
 * everything a send needs — and nothing a reader would have to trust. What it
 * deliberately does not carry is identity: the effect id is the journal's own
 * key, and the marker a comment is recognised by is rebuilt from that key, so
 * a tampered row cannot make some other comment match.
 */

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
 *
 * `applied` and `already` are the two ways the plan is realised: because this
 * pass changed GitHub, or because it did not have to. `refused` is a gate or
 * GitHub saying no, and it is FINAL for the world it was decided in — the
 * journal row is closed. `retryLater` and `unknown` both leave the row open
 * for the sweep; they differ in what is known, which is what the endpoint
 * matrix's own two words mean (`WriteResult`).
 */
export const EFFECT_OUTCOMES = ["applied", "already", "refused", "retryLater", "unknown"] as const;

/** One of `EFFECT_OUTCOMES`. */
export type EffectOutcomeName = (typeof EFFECT_OUTCOMES)[number];

/**
 * Why an outcome is what it is, for the reasons the safety ladder has no code
 * for — everything that happens BELOW a verdict.
 *
 * Core's `SafetyRefusalCode` and `RecordOnlyCode` cover every refusal a gate
 * reaches, and those are reported unchanged. These are the applier's own:
 * `leaseHeld` and `rowUnreadable` are states of the store, the four `write*`
 * words are GitHub's answer as the matrix names it, and the remaining three
 * are reads that established nothing.
 */
export const EFFECT_CODES = [
    "leaseHeld",
    "rowUnreadable",
    "configurationChanged",
    "identityMissing",
    "labelUnmapped",
    "itemUnreadable",
    "externalsUnavailable",
    "writeConflict",
    "writeForbidden",
    "writeRetryLater",
    "writeUnknown",
    "postconditionUnconfirmed",
] as const;

/** One of `EFFECT_CODES`. */
export type EffectCode = (typeof EFFECT_CODES)[number];

/** Every code an outcome may carry: a verdict's, or one of the applier's own. */
export type EffectOutcomeCode = SafetyRefusalCode | RecordOnlyCode | EffectCode;

/**
 * One effect's fate, as the decision record and the operator log report it.
 *
 * `code` is `null` only when nothing refused and nothing was ambiguous.
 * `detail` is prose about what happened and the one field nothing should
 * parse.
 */
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

/**
 * One GitHub call, named by the postcondition it establishes rather than by
 * the verb it happens to use. One line per operation, and the closed
 * vocabulary every handler is written against.
 *
 * `postComment` is deliberately not "create": its realisation is D12's — an
 * App-authored comment bearing this effect's marker either does not exist and
 * is created, or exists and is left alone or updated. One name, because a
 * resend must not have to know which of the three the first attempt chose.
 *
 * `body` is the RENDERED body, marker first. `parseManagedMarker` requires the
 * marker to be the body's opening bytes, so composing it at plan time is what
 * makes the bytes in the row exactly the bytes that will be sent.
 */
export type Call =
    | {
          readonly verb: "postComment";
          readonly kind: ManagedCommentKind;
          readonly body: string;
      }
    | { readonly verb: "addLabel"; readonly label: string }
    | { readonly verb: "removeLabel"; readonly label: string }
    | { readonly verb: "assign"; readonly login: string }
    | { readonly verb: "unassign"; readonly login: string }
    | { readonly verb: "releaseAssignment"; readonly login: string }
    | { readonly verb: "closePullRequest"; readonly reason: string }
    | { readonly verb: "lockIssue"; readonly reason: string }
    | { readonly verb: "unlockIssue"; readonly reason: string };

/**
 * One call as its journal row spells it — the row's `intent` column, parsed.
 *
 * `capability` and `item` ride along because a resend addresses a call the
 * decision that planned it is long gone from. The operation is not stored: it
 * follows from the verb, and a fact derivable from the row is a fact that
 * cannot disagree with it.
 */
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
 * The bytes a managed comment is posted as: the marker, then the capability's
 * content, separated by a blank line so GitHub renders the content as its own
 * first block. The marker must be first — `parseManagedMarker` requires it,
 * and a marker anywhere else is not even a claim (D125).
 */
export function renderManagedBody(marker: string, body: string): string {
    return `${marker}\n\n${body}`;
}
