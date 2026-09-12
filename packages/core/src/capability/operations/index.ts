/**
 * The registry: every operation the platform knows, one module each. A module
 * holds the two things the PLATFORM decides and a capability may not — the
 * operation's facts (idempotency, action-class floor, permission) and the
 * words its change is recorded in.
 *
 * ADDING AN OPERATION is one module in this directory and one key in
 * `IntentCatalogue`. `OPERATIONS` is where a missing module fails to compile
 * — its mapped type is the checklist, and it is the only place the
 * operations are listed. Nothing here imports `intent.ts`, `declaration.ts` or
 * the engine: the catalogue is below, everything else above. The
 * desired-outcome shapes stay in `../catalogue.ts` because they are vocabulary
 * a capability sees.
 *
 * TWO TRAPS. `INTENT_OPERATIONS` is DERIVED, not declared — it reads each
 * module's `facts`, so a fact changes in its module and nowhere else. And a
 * change wording is a PINNED STRING: `describeChange`'s output lands in the
 * safety record, the dry-run rehearsal and the destructive warning snapshot,
 * and the parity test compares it literally, so rewording one is a behaviour
 * change rather than a comment edit.
 */

import type { IntentOperation, OperationFacts } from "../catalogue.js";
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

/**
 * The platform's authoritative facts for every operation.
 *
 * Each key reads its module's `facts`, so the table is derived rather than a
 * second copy. It is spelled key by key because the generic walk that would
 * write it in one line needs a cast, and this migration spends its one cast
 * on the engine's recipe.
 */
export const INTENT_OPERATIONS: {
    readonly [K in IntentOperation]: OperationFacts;
} = {
    postManagedComment: OPERATIONS.postManagedComment.facts,
    applyMappedLabel: OPERATIONS.applyMappedLabel.facts,
    assign: OPERATIONS.assign.facts,
    unassign: OPERATIONS.unassign.facts,
    releaseAssignment: OPERATIONS.releaseAssignment.facts,
    closePullRequest: OPERATIONS.closePullRequest.facts,
    lockIssue: OPERATIONS.lockIssue.facts,
    unlockIssue: OPERATIONS.unlockIssue.facts,
};
