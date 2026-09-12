/** A clock-triggered release — refused at the send, because no confirmed write endpoint takes a person off an item. */

import { planWithNotice, type OperationHandler } from "./handler.js";
import { text } from "./row.js";

export const releaseAssignment: OperationHandler<"releaseAssignment"> = {
    verbs: ["releaseAssignment"],

    /** Two calls, because a release is graced: the release, then its notice (grace.md §3). */
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

    /** Refused here rather than earlier, so plan, row and dispatch stay identical. */
    send: async () => ({
        outcome: "forbidden",
        detail: "no confirmed write endpoint releases an assignment; the adapter has four, and none of them is this",
    }),

    // Unreachable: `send` refuses this verb before it is proved.

    confirm: async () => "unknown",
};
