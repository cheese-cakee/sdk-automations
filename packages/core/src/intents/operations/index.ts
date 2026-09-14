/**
 * The registry: every operation the platform knows, one module each.
 * A change wording is a PINNED STRING: the parity test compares
 * `describeChange`'s output literally, so rewording one is a behaviour change.
 */

import type { IntentOperation, OperationFacts } from "../../catalogue.js";
import { applyMappedLabel } from "./applyMappedLabel.js";
import { assign } from "./assign.js";
import { closePullRequest } from "./closePullRequest.js";
import { lockIssue } from "./lockIssue.js";
import type { OperationModule } from "./module.js";
import { postManagedComment } from "./postManagedComment.js";
import { releaseAssignment } from "./releaseAssignment.js";
import { unassign } from "./unassign.js";
import { unlockIssue } from "./unlockIssue.js";

export type { ChangeSubject, OperationModule } from "./module.js";

/** Every operation's module, keyed by operation. */
export const OPERATIONS: {
    readonly [K in IntentOperation]: OperationModule<K>;
} = {
    postManagedComment,
    applyMappedLabel,
    assign,
    unassign,
    releaseAssignment,
    closePullRequest,
    lockIssue,
    unlockIssue,
};

/** The platform's authoritative facts for every operation, read from each module. */
export const INTENT_OPERATIONS: {
    readonly [K in IntentOperation]: OperationFacts;
} = Object.fromEntries(
    Object.entries(OPERATIONS).map(([operation, module]) => [operation, module.facts]),
) as { readonly [K in IntentOperation]: OperationFacts };
