/**
 * An issue unlocked, so anyone may comment on it again.
 *
 * The other direction of `lockIssue`, and its mirror in every fact. Opening a
 * conversation back up is the more permissive act, so it stays
 * `reversibleStateChange` rather than dropping to `humanFacingOutput`: it
 * changes the item's state, and the ladder judges the change, not its mood.
 */

import type { OperationModule } from "./module.js";

export const unlockIssue: OperationModule<"unlockIssue"> = {
    facts: {
        idempotencyClass: "idempotent",
        actionClassFloor: "reversibleStateChange",
        permission: "issues:write",
    },
    describeChange(subject) {
        return `unlock issue: ${subject.desired.reason}`;
    },
};
