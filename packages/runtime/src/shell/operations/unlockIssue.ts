/**
 * Unlocking an issue's conversation — and refused at the send, for the same
 * reason its mirror is: `DELETE /repos/{o}/{r}/issues/{n}/lock` is not a
 * confirmed row of the endpoint matrix.
 *
 * Kept a whole module rather than folded into `lockIssue` with a flag, because
 * the registry is keyed by operation and the two operations are two.
 */

import type { OperationHandler } from "./handler.js";
import { text } from "./row.js";

/** The `unlockIssue` operation, as the registry holds it. */
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
        outcome: "forbidden",
        detail: "no confirmed write endpoint unlocks an issue; the adapter has four, and none of them is this",
    }),

    // Unreachable: `send` refuses this verb before it is proved.
    confirm: async () => "unknown",
};
