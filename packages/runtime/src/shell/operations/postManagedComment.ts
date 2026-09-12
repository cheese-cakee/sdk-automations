/**
 * Posting one managed comment, whole: what it plans, how its row is spelled
 * and read, and D12's create-or-update at the send.
 *
 * The only operation that reads before it writes, which is why the read-back
 * that finds this effect's own comment lives here rather than in the applier.
 */

import { MANAGED_COMMENT_KINDS, type ManagedCommentKind } from "@hiero-hackers/automation-core";
import { renderManagedBody } from "../effects.js";
import {
    type CommentSeen,
    type OperationHandler,
    type ReadAnswer,
    type SendContext,
} from "./handler.js";
import { text } from "./row.js";

const isManagedCommentKind = (value: string): value is ManagedCommentKind =>
    (MANAGED_COMMENT_KINDS as readonly string[]).includes(value);

/**
 * The comment standing under this call's identity, `null` when there provably
 * is none, or the reason neither could be established.
 *
 * The `null` costs D46's gap, and that is the whole point: a stale
 * "absent" here is what makes a comment create run twice, which is the
 * duplicate protocol 6.5 measured. A match found on the first read is
 * believed at once, because a visible comment is a landed one.
 */
const matchedComment = async (
    pass: SendContext,
    body: string,
): Promise<ReadAnswer<CommentSeen | null>> => {
    const mine = pass.isMine(body);
    const listed = await pass.reader.comments(pass.item);
    if (!listed.ok) return { ok: false, detail: `the comment read-back failed: ${listed.detail}` };
    const found = listed.value.find(mine);
    if (found !== undefined) return { ok: true, value: found };
    const confirmed = await pass.reader.commentPresence(pass.item, mine);
    if (confirmed === "absent") return { ok: true, value: null };
    return {
        ok: false,
        detail:
            confirmed === "present"
                ? "this comment's managed identity appeared between two reads"
                : "the read-back could not establish whether a comment under this identity exists",
    };
};

/** The `postManagedComment` operation, as the registry holds it. */
export const postManagedComment: OperationHandler<"postManagedComment"> = {
    verbs: ["postComment"],

    plan(effect) {
        if (effect.managedComment === null) {
            return {
                ok: false,
                code: "identityMissing",
                detail: "the approved effect carries no managed-comment identity to post under",
            };
        }
        return {
            ok: true,
            calls: [
                {
                    verb: "postComment",
                    kind: effect.intent.desired.kind,
                    body: renderManagedBody(
                        effect.managedComment.marker,
                        effect.intent.desired.body,
                    ),
                },
            ],
        };
    },

    serialize: (call) => ({ verb: call.verb, kind: call.kind, body: call.body }),

    parse(row) {
        const kind = text(row, "kind");
        const body = text(row, "body");
        if (kind === null || !isManagedCommentKind(kind) || body === null) return null;
        return { verb: "postComment", kind, body };
    },

    /**
     * D12, in full. The marker read-back runs first: no match creates, a match
     * with the same body is `already`, and a match with a different body is
     * updated in place — which is also the documented answer to a human
     * editing a managed comment, and, since identity is per item and purpose,
     * to a LATER OCCASION with something new to say (D145). The restoration
     * happens only because a fresh decision produced this effect and reached
     * this line. Nothing repairs a comment in the background: the read-back
     * that recovery uses matches on IDENTITY alone, so an edited comment is a
     * landed comment and no resend is triggered by the edit.
     */
    async send(call, pass) {
        const found = await matchedComment(pass, call.body);
        if (!found.ok) return { outcome: "retryLater", detail: found.detail };
        if (found.value === null) return await pass.writer.createComment(pass.item, call.body);
        if (found.value.body === call.body) return { outcome: "already" };
        return await pass.writer.updateComment(found.value.id, call.body);
    },

    /** Confirms the exact body so a lost update response cannot accept the old comment. */
    async confirm(call, pass) {
        const found = await matchedComment(pass, call.body);
        if (!found.ok) return "unknown";
        return found.value?.body === call.body ? "held" : "notHeld";
    },
};
