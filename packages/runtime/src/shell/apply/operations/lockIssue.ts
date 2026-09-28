/** Locking an issue's conversation: the plan, its row, and the state read that proves it. */

import type { OperationHandler } from "./handler.js";

export const lockIssue: OperationHandler<"lockIssue"> = {
    verbs: ["lockIssue"],
    traits: { recordsWarning: false, activityRead: false },

    plan: () => ({
        ok: true,
        calls: [{ verb: "lockIssue" }],
    }),

    serialize: (call) => ({ verb: call.verb }),

    parse: () => ({ verb: "lockIssue" }),

    send: async (_call, pass) => await pass.writer.lockIssue(pass.item, pass.allowance),

    async confirm(_call, pass) {
        const seen = await pass.reader.item(pass.item);
        if (!seen.ok) return "unknown";
        return seen.value.locked ? "held" : "notHeld";
    },
};
