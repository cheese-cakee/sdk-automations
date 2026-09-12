/** Locking an issue's conversation — refused at the send, because no confirmed write endpoint locks one. */

import type { OperationHandler } from "./handler.js";
import { text } from "./row.js";

export const lockIssue: OperationHandler<"lockIssue"> = {
    verbs: ["lockIssue"],

    /** The reason travels on the call, because the row is what a resend reads. */
    plan: (effect) => ({
        ok: true,
        calls: [{ verb: "lockIssue", reason: effect.intent.desired.reason }],
    }),

    serialize: (call) => ({ verb: call.verb, reason: call.reason }),

    parse(row) {
        const reason = text(row, "reason");
        return reason === null ? null : { verb: "lockIssue", reason };
    },

    /** Refused here rather than earlier, so plan, row and dispatch stay identical. */
    send: async () => ({
        outcome: "forbidden",
        detail: "no confirmed write endpoint locks an issue; the adapter has four, and none of them is this",
    }),

    // Unreachable: `send` refuses this verb before it is proved.

    confirm: async () => "unknown",
};
