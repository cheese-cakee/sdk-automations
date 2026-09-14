/** Unlocking an issue's conversation — refused at the send, for the same reason its mirror is. */

import type { OperationHandler } from "./handler.js";
import { text } from "./row.js";

export const unlockIssue: OperationHandler<"unlockIssue"> = {
    verbs: ["unlockIssue"],

    plan: (effect) => ({
        ok: true,
        calls: [{ verb: "unlockIssue", reason: effect.intent.desired.reason }],
    }),

    serialize: (call) => ({ verb: call.verb, reason: call.reason }),

    parse(row) {
        const reason = text(row, "reason");
        return reason === null ? null : { verb: "unlockIssue", reason };
    },

    send: async () => ({
        outcome: "unsupported",
        detail: "no confirmed write endpoint unlocks an issue; the adapter has four, and none of them is this",
    }),

    // Unreachable: `send` refuses this verb before it is proved.

    confirm: async () => "unknown",
};
