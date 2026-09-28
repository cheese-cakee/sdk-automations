/** Unlocking an issue's conversation: the plan, its row, and the state read that proves it. */

import type { OperationHandler } from "./handler.js";

export const unlockIssue: OperationHandler<"unlockIssue"> = {
    verbs: ["unlockIssue"],
    traits: { recordsWarning: false, activityRead: false },

    plan: () => ({
        ok: true,
        calls: [{ verb: "unlockIssue" }],
    }),

    serialize: (call) => ({ verb: call.verb }),

    parse: () => ({ verb: "unlockIssue" }),

    send: async (_call, pass) => await pass.writer.unlockIssue(pass.item, pass.allowance),

    async confirm(_call, pass) {
        const seen = await pass.reader.item(pass.item);
        if (!seen.ok) return "unknown";
        return seen.value.locked ? "notHeld" : "held";
    },
};
