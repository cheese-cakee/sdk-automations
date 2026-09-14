/**
 * The registry: one transport per operation, and the walk that composes the verbs.
 * `TRANSPORTS` is the only place the operations are listed.
 */

import type { IntentOperation } from "@hiero-hackers/automation-core";
import { APPLY_MAPPED_LABEL } from "./applyMappedLabel.js";
import { ASSIGN } from "./assign.js";
import { CLOSE_PULL_REQUEST } from "./closePullRequest.js";
import { LOCK_ISSUE } from "./lockIssue.js";
import { POST_MANAGED_COMMENT } from "./postManagedComment.js";
import { RELEASE_ASSIGNMENT } from "./releaseAssignment.js";
import type { OperationTransport, VerbContext, WriteVerbs } from "./transport.js";
import { UNASSIGN } from "./unassign.js";
import { UNLOCK_ISSUE } from "./unlockIssue.js";

/** Every write operation's transport, keyed by the operation core names. */
export const TRANSPORTS: { readonly [K in IntentOperation]: OperationTransport } = {
    postManagedComment: POST_MANAGED_COMMENT,
    applyMappedLabel: APPLY_MAPPED_LABEL,
    assign: ASSIGN,
    unassign: UNASSIGN,
    releaseAssignment: RELEASE_ASSIGNMENT,
    closePullRequest: CLOSE_PULL_REQUEST,
    lockIssue: LOCK_ISSUE,
    unlockIssue: UNLOCK_ISSUE,
};

/** The whole write surface, composed from the verbs every transport contributes. */
export function writeVerbsOf(context: VerbContext): WriteVerbs {
    return Object.values(TRANSPORTS).reduce<Partial<WriteVerbs>>(
        (verbs, transport) => ({ ...verbs, ...transport.verbs(context) }),
        {},
    ) as WriteVerbs;
}
