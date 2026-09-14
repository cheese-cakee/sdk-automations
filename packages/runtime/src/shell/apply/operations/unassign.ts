/** Taking one person off an item, whole — refused at the send, because no confirmed write endpoint does it. */

import type { OperationHandler } from "./handler.js";
import { text } from "./row.js";

export const unassign: OperationHandler<"unassign"> = {
    verbs: ["unassign"],

    plan: (effect) => ({
        ok: true,
        calls: [{ verb: "unassign", login: effect.intent.desired.login }],
    }),

    serialize: (call) => ({ verb: call.verb, login: call.login }),

    parse(row) {
        const login = text(row, "login");
        return login === null ? null : { verb: "unassign", login };
    },

    /** Refused here rather than earlier, so plan, row and dispatch stay identical. */
    send: async () => ({
        outcome: "unsupported",
        detail: "no confirmed write endpoint unassigns; the adapter has four, and none of them is this",
    }),

    // Unreachable: `send` refuses this verb before it is proved.

    confirm: async () => "unknown",
};
