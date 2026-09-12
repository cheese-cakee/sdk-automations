/**
 * Locking an issue's conversation — and refused at the send, because no
 * confirmed write endpoint locks one.
 *
 * A complete handler for an operation the write surface cannot yet reach, in
 * the shape `unassign` and `closePullRequest` already hold. The real lock
 * lands as an endpoint in the adapter's module of the same name — that needs
 * `PUT /repos/{o}/{r}/issues/{n}/lock` observed in a sandbox run and cited in
 * `design/findings/endpoint-permission-matrix.md` — and this file changes only
 * at `send`.
 */

import type { OperationHandler } from "./handler.js";
import { text } from "./row.js";

/** The `lockIssue` operation, as the registry holds it. */
export const lockIssue: OperationHandler<"lockIssue"> = {
    verbs: ["lockIssue"],

    /**
     * The reason travels on the call because the row is what a resend reads:
     * the sentence recorded for a moderation must survive the decision that
     * wrote it.
     */
    plan: (effect) => ({
        ok: true,
        calls: [{ verb: "lockIssue", reason: effect.intent.desired.reason }],
    }),

    serialize: (call) => ({ verb: call.verb, reason: call.reason }),

    parse(row) {
        const reason = text(row, "reason");
        return reason === null ? null : { verb: "lockIssue", reason };
    },

    /**
     * Refused here rather than earlier, so the plan, the journal row and the
     * dispatch stay identical for every operation.
     */
    send: async () => ({
        outcome: "forbidden",
        detail: "no confirmed write endpoint locks an issue; the adapter has four, and none of them is this",
    }),

    // Nothing reads an item's lock state, so nothing can prove one.
    // Unreachable: `send` refuses this verb before it is proved.
    confirm: async () => "unknown",
};
