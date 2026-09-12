/** One named login, added to an item's assignees at that person's own request (D63). */

import type { OperationModule } from "./module.js";

export const assign: OperationModule<"assign"> = {
    facts: {
        idempotencyClass: "idempotent",
        actionClassFloor: "reversibleStateChange",
        permission: "issues:write",
    },
    describeChange(subject) {
        return `assign ${subject.desired.login}`;
    },
};
