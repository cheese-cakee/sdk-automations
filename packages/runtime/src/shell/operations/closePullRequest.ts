/**
 * Closing a pull request unmerged — and refused at the send, because no
 * confirmed write endpoint closes one.
 *
 * A complete handler for an operation the write surface cannot yet reach. The
 * pull-request write lands as an endpoint in the adapter's module of the same
 * name, and this file changes only at `send`.
 */

import { planWithNotice, type OperationHandler } from "./handler.js";
import { text } from "./row.js";

/** The `closePullRequest` operation, as the registry holds it. */
export const closePullRequest: OperationHandler<"closePullRequest"> = {
    verbs: ["closePullRequest"],

    /**
     * The reason travels on the call because the row is what a resend reads:
     * the sentence a maintainer is owed must survive the decision that wrote
     * it. A close is graced, so the notice saying it happened follows it
     * (grace.md §3); the plan stops at the first refusal, so the notice never
     * claims a close that did not land.
     */
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

    /**
     * Refused here rather than earlier, so the plan, the journal row and the
     * dispatch stay identical for every operation.
     */
    send: async () => ({
        outcome: "forbidden",
        detail: "no confirmed write endpoint closes a pull request; the adapter has four, and none of them is this",
    }),

    // Nothing reads a pull request's state, so nothing can prove one closed.
    // Unreachable: `send` refuses this verb before it is proved.
    confirm: async () => "unknown",
};
