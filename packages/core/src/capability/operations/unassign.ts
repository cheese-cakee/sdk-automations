/**
 * One named login, removed from an item's assignees.
 *
 * The desired shape this operation takes lives in the catalogue, with the
 * rest of the vocabulary a capability sees.
 */

import type { OperationModule } from "./module.js";

export const unassign: OperationModule<"unassign"> = {
    facts: {
        idempotencyClass: "idempotent",
        actionClassFloor: "reversibleStateChange",
        permission: "issues:write",
    },
    describeChange(subject) {
        return `unassign ${subject.desired.login}`;
    },
};
