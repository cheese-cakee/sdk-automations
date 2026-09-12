/**
 * Putting one person on an item's assignees — and refused at the send,
 * because no confirmed write endpoint does it.
 *
 * A complete handler for an operation the write surface cannot yet reach, in
 * the shape `unassign` already holds: `POST /repos/{o}/{r}/issues/{n}/assignees`
 * is absent from `design/findings/endpoint-permission-matrix.md`, so the real
 * assign lands as an endpoint in the adapter's module of the same name and
 * this file changes only at `send`.
 */

import type { OperationHandler } from "./handler.js";
import { text } from "./row.js";

/** The `assign` operation, as the registry holds it. */
export const assign: OperationHandler<"assign"> = {
    verbs: ["assign"],

    /** One call like any other; the refusal is where every call is sent. */
    plan: (effect) => ({
        ok: true,
        calls: [{ verb: "assign", login: effect.intent.desired.login }],
    }),

    serialize: (call) => ({ verb: call.verb, login: call.login }),

    parse(row) {
        const login = text(row, "login");
        return login === null ? null : { verb: "assign", login };
    },

    /**
     * Refused here rather than earlier, so the plan, the journal row and the
     * dispatch stay identical for every operation.
     */
    send: async () => ({
        outcome: "forbidden",
        detail: "no confirmed write endpoint assigns; the adapter has four, and none of them is this",
    }),

    // Nothing reads an assignee list, so nothing can prove one.
    // Unreachable: `send` refuses this verb before it is proved.
    confirm: async () => "unknown",
};
