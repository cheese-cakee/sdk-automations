/**
 * Taking one person off an item, whole — and refused at the send, because no
 * confirmed write endpoint does it.
 *
 * A complete handler for an operation the write surface cannot yet reach. The
 * real unassign lands as an endpoint in the adapter's module of the same name,
 * and this file changes only at `send`.
 */

import type { OperationHandler } from "./handler.js";
import { text } from "./row.js";

/** The `unassign` operation, as the registry holds it. */
export const unassign: OperationHandler<"unassign"> = {
    verbs: ["unassign"],

    /**
     * `unassign` plans mechanically, one call like any other, and is refused
     * where every call is sent: the write surface is the four endpoints the
     * matrix confirmed, and none of them unassigns. Nothing in the catalogue
     * constructs it today, so the refusal is a shape this file keeps total
     * rather than a path anything travels.
     */
    plan: (effect) => ({
        ok: true,
        calls: [{ verb: "unassign", login: effect.intent.desired.login }],
    }),

    serialize: (call) => ({ verb: call.verb, login: call.login }),

    parse(row) {
        const login = text(row, "login");
        return login === null ? null : { verb: "unassign", login };
    },

    /**
     * Refused here rather than earlier, so the plan, the journal row and the
     * dispatch stay identical for every operation.
     */
    send: async () => ({
        outcome: "forbidden",
        detail: "no confirmed write endpoint unassigns; the adapter has four, and none of them is this",
    }),

    // Nothing reads an assignee list, so nothing can prove one.
    // Unreachable: `send` refuses this verb before it is proved.
    confirm: async () => "unknown",
};
