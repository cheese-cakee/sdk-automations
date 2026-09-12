/**
 * An issue locked so that only maintainers may comment on it.
 *
 * `reversibleStateChange`, and the whole reason the pair is two operations
 * rather than one with a boolean: an operator reading a journal row should
 * see which direction the moderation went without decoding a flag, and the
 * two directions do not share a postcondition.
 *
 * `reason` is the sentence the lock is recorded under — the words a
 * maintainer reads in the report, not GitHub's own `lock_reason` vocabulary,
 * which the write surface cannot reach today anyway.
 */

import type { OperationModule } from "./module.js";

export const lockIssue: OperationModule<"lockIssue"> = {
    facts: {
        idempotencyClass: "idempotent",
        actionClassFloor: "reversibleStateChange",
        permission: "issues:write",
    },
    describeChange(subject) {
        return `lock issue: ${subject.desired.reason}`;
    },
};
