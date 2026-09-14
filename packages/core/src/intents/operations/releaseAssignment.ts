/** One named login, taken off an item's assignees because a clock ran out (D63). */

import type { OperationModule } from "./module.js";

export const releaseAssignment: OperationModule<"releaseAssignment"> = {
    facts: {
        idempotencyClass: "idempotent",
        actionClassFloor: "clockTriggeredDestructive",
        permission: "issues:write",
    },
    describeChange(subject) {
        return `release ${subject.desired.login}`;
    },
};
