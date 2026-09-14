/**
 * Every write operation there is, and the six generic walks over them.
 * Journal-row compatibility is absolute: a handler may ADD a verb, never rename one,
 * reorder a field, or change what `parse` refuses (write-operations.md §5).
 */

import type { Effect, IntentOperation, RepositoryConfig } from "@hiero-hackers/automation-core";
import type { Call, JournaledCall, Plan } from "../../effects.js";
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

/** The only place the operations are listed; one with no handler fails to compile here. */
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

// ─── The operation a call belongs to ─────────────────────────────────

/** The operation is read off the call being handed back, so both come from one entry. */
const handlerFor = (operation: IntentOperation): OperationHandler<IntentOperation> =>
    HANDLERS[operation] as OperationHandler<IntentOperation>;

/** Keyed by `string` because `parseJournaledCall` asks it about bytes. */
const OWNER_OF_VERB = new Map<string, IntentOperation>(
    Object.entries(HANDLERS).flatMap(([operation, handler]) =>
        handler.verbs.map((verb) => [verb, operation as IntentOperation] as const),
    ),
);

/** The operation a call belongs to — the derivation the row relies on. */
export function operationOf(call: Call): IntentOperation {
    // Total by construction: every member of `Call` is some handler's verb.

    return OWNER_OF_VERB.get(call.verb)!;
}

// ─── The row ─────────────────────────────────────────────────────────

/** Every field is written out rather than spread: insertion order IS the row's bytes. */
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

/** Defensive in full: the answer to `null` is close the row and resend nothing. */
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

/** Does GitHub say this call's postcondition holds? */
export const confirmCall = async (call: Call, pass: SendContext): Promise<Confirmation> =>
    await handlerFor(operationOf(call)).confirm(call, pass);
