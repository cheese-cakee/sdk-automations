/**
 * Every write operation there is, and the six generic walks over them.
 *
 * `HANDLERS` is the only place the operations are listed, which is what
 * `design/guides/write-operations.md` §5 asks this layer to prove: an
 * operation with no handler fails to compile here, on the registry object,
 * rather than at some downstream use. Everything below it — `effects.ts`'s
 * four exported functions and the applier's two dispatchers — is a walk that
 * knows no verb.
 *
 * ADDING AN OPERATION is one handler module here and one line in the `Call`
 * union in `effects.ts`; register the handler below and every walk picks it
 * up. The union stays hand-written, one line per operation,
 * because deriving it would trade a closed vocabulary a reader can see for a
 * type-level puzzle (write-operations.md §6). This directory owns only the
 * calls: the vocabulary is `effects.ts`'s and the choreography — lease,
 * journal, re-gate, send — is `apply.ts`'s, and nothing here imports it.
 *
 * THE RULE NOTHING HERE MAY BREAK: journal-row compatibility is absolute.
 * `serializeCall` writes `{capability, item}` and then the handler's fields,
 * so the bytes are what they have always been and every row an armed sandbox
 * has written must still parse. A handler may ADD a verb; it may never rename
 * a verb, rename or reorder a field, or change what `parse` refuses. The guard
 * is the literal-string pins in `test/effects.test.ts`'s *the journal row*
 * block, one per verb, never edited since.
 */

import type { Effect, IntentOperation, RepositoryConfig } from "@hiero-hackers/automation-core";
import type { Call, JournaledCall, Plan } from "../effects.js";
import { applyMappedLabel } from "./applyMappedLabel.js";
import { assign } from "./assign.js";
import { closePullRequest } from "./closePullRequest.js";
import type { Confirmation, OperationHandler, SendContext, WriteResult } from "./handler.js";
import { lockIssue } from "./lockIssue.js";
import { postManagedComment } from "./postManagedComment.js";
import { releaseAssignment } from "./releaseAssignment.js";
import { at, itemOf, text } from "./row.js";
import { unassign } from "./unassign.js";
import { unlockIssue } from "./unlockIssue.js";

// ─── The registry ────────────────────────────────────────────────────

/** Every write operation the shell carries out, one handler each. */
const HANDLERS: { readonly [K in IntentOperation]: OperationHandler<K> } = {
    postManagedComment,
    applyMappedLabel,
    assign,
    unassign,
    releaseAssignment,
    closePullRequest,
    lockIssue,
    unlockIssue,
};

/**
 * One handler, with its call types widened to the whole union.
 *
 * `HANDLERS[operation]` is the union of the three handler types, and calling a
 * method on a union asks for the INTERSECTION of its parameter types, which
 * here is `never`. The widening is the one assertion this file makes, and it
 * is safe for a reason the compiler cannot see: the operation is read from the
 * call — or from the intent — that is about to be handed back, so the handler
 * and its argument always come from the same registry entry. TypeScript
 * cannot correlate a lookup's key with the parameter type of the value found.
 */
const handlerFor = (operation: IntentOperation): OperationHandler<IntentOperation> =>
    HANDLERS[operation] as OperationHandler<IntentOperation>;

// ─── The operation a call belongs to ─────────────────────────────────

/**
 * Which operation owns each call verb, folded once from the registry.
 *
 * Keyed by `string` rather than by the verb union, because `parseJournaledCall`
 * asks it about bytes: a row's `verb` is whatever was written down, and a miss
 * is the honest answer for a verb no handler owns.
 */
const OWNER_OF_VERB = new Map<string, IntentOperation>(
    Object.entries(HANDLERS).flatMap(([operation, handler]) =>
        handler.verbs.map((verb) => [verb, operation as IntentOperation] as const),
    ),
);

/** The operation a call belongs to — the derivation the row relies on. */
export function operationOf(call: Call): IntentOperation {
    // Total by construction: every member of `Call` is some handler's verb, so
    // the miss is unreachable through the type. A verb no handler owns cannot
    // be built as a `Call` at all, and a row naming one is answered `null` by
    // `parseJournaledCall` long before this.
    return OWNER_OF_VERB.get(call.verb)!;
}

// ─── The row ─────────────────────────────────────────────────────────

/**
 * The row's bytes for one call.
 *
 * Every field is written out rather than spread, for the reason
 * `deriveManagedMarker` writes its payload out: `JSON.stringify` preserves
 * insertion order, and a row's spelling must not depend on how the record
 * reached this function. The head is written here so that insertion order —
 * and therefore bytes — cannot depend on which handler answered.
 */
export function serializeCall(journaled: JournaledCall): string {
    const { capability, item, call } = journaled;
    const head = { capability, item: { kind: item.kind, number: item.number } };
    const fields = handlerFor(operationOf(call)).serialize(call);
    return JSON.stringify({ ...head, ...fields });
}

/** The call one row carries, or `null` when the bytes are not one. */
const callOf = (row: unknown): Call | null => {
    const verb = at(row, "verb");
    const operation = typeof verb === "string" ? OWNER_OF_VERB.get(verb) : undefined;
    return operation === undefined ? null : HANDLERS[operation].parse(row);
};

/**
 * The call a journal row holds, or `null` when it holds none.
 *
 * Defensive in full, though this process wrote the bytes: they crossed a
 * durability boundary that outlives the version that wrote them, and the
 * caller's answer to `null` — close the row, resend nothing — is one it can
 * only give if this never throws.
 */
export function parseJournaledCall(row: string): JournaledCall | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(row);
    } catch {
        return null;
    }
    const capability = text(parsed, "capability");
    const item = itemOf(at(parsed, "item"));
    const call = callOf(parsed);
    if (capability === null || item === null || call === null) return null;
    return { capability, item, call };
}

// ─── The plan ────────────────────────────────────────────────────────

/** The calls one approved effect takes, in the order they must be sent. */
export function planFor(effect: Effect, config: RepositoryConfig): Plan {
    return handlerFor(effect.intent.operation).plan(effect, config);
}

// ─── The dispatch ────────────────────────────────────────────────────

/** One call, sent. */
export const sendCall = async (call: Call, pass: SendContext): Promise<WriteResult> =>
    await handlerFor(operationOf(call)).send(call, pass);

/**
 * Does GitHub say this call's postcondition holds?
 *
 * The same question serves both jobs: verifying a write that reported
 * success, and reconciling a row whose answer was lost.
 */
export const confirmCall = async (call: Call, pass: SendContext): Promise<Confirmation> =>
    await handlerFor(operationOf(call)).confirm(call, pass);
