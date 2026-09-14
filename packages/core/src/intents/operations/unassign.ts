/** One named login, removed from an item's assignees. */

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
