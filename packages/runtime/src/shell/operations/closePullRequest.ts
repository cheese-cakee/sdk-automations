/** Closing a pull request unmerged — refused at the send, because no confirmed write endpoint closes one. */

import { planWithNotice, type OperationHandler } from "./handler.js";
import { text } from "./row.js";

export const closePullRequest: OperationHandler<"closePullRequest"> = {
    verbs: ["closePullRequest"],

    /** The reason travels on the call, because the row is what a resend reads. */
    plan: (effect) =>
        planWithNotice(effect, {
            verb: "closePullRequest",
            reason: effect.intent.desired.reason,
        }),

    serialize: (call) => ({ verb: call.verb, reason: call.reason }),

    parse(row) {
        const reason = text(row, "reason");
        return reason === null ? null : { verb: "closePullRequest", reason };
    },

    /** Refused here rather than earlier, so plan, row and dispatch stay identical. */
    send: async () => ({
        outcome: "forbidden",
        detail: "no confirmed write endpoint closes a pull request; the adapter has four, and none of them is this",
    }),

    // Unreachable: `send` refuses this verb before it is proved.

    confirm: async () => "unknown",
};
