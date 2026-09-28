/** Putting one person on an item's assignees — refused at the send, because no confirmed write endpoint does it. */

import type { OperationHandler } from "./handler.js";
import { text } from "./row.js";

export const assign: OperationHandler<"assign"> = {
    verbs: ["assign"],
    traits: { recordsWarning: false, activityRead: false },

    plan: (effect) => ({
        ok: true,
        calls: [{ verb: "assign", login: effect.intent.desired.login }],
    }),

    serialize: (call) => ({ verb: call.verb, login: call.login }),

    parse(row) {
        const login = text(row, "login");
        return login === null ? null : { verb: "assign", login };
    },

    /** Refused here rather than earlier, so plan, row and dispatch stay identical. */
    send: async () => ({
        outcome: "unsupported",
        detail: "no confirmed write endpoint assigns",
    }),

    // Unreachable: `send` refuses this verb before it is proved.

    confirm: async () => "unknown",
};
