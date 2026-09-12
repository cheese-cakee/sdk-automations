/**
 * A clock-triggered release — and refused at the send, because no confirmed
 * write endpoint takes a person off an item.
 *
 * A complete handler for an operation the write surface cannot yet reach. The
 * assignee write family lands as an endpoint in the adapter's module of the
 * same name, and this file changes only at `send`.
 */

import { planWithNotice, type OperationHandler } from "./handler.js";
import { text } from "./row.js";

/** The `releaseAssignment` operation, as the registry holds it. */
export const releaseAssignment: OperationHandler<"releaseAssignment"> = {
    verbs: ["releaseAssignment"],

    /**
     * Two calls, because a release is graced: the release, then the notice
     * saying it happened (grace.md §3). Only the first is refused where every
     * call is sent — the write surface is the four endpoints the matrix
     * confirmed, and none of them releases an assignment — and the plan stops
     * there, so the notice never claims a release that did not land.
     */
    plan: (effect) =>
        planWithNotice(effect, {
            verb: "releaseAssignment",
            login: effect.intent.desired.login,
        }),

    serialize: (call) => ({ verb: call.verb, login: call.login }),

    parse(row) {
        const login = text(row, "login");
        return login === null ? null : { verb: "releaseAssignment", login };
    },

    /**
     * Refused here rather than earlier, so the plan, the journal row and the
     * dispatch stay identical for every operation.
     */
    send: async () => ({
        outcome: "forbidden",
        detail: "no confirmed write endpoint releases an assignment; the adapter has four, and none of them is this",
    }),

    // Nothing reads an assignee list, so nothing can prove one.
    // Unreachable: `send` refuses this verb before it is proved.
    confirm: async () => "unknown",
};
