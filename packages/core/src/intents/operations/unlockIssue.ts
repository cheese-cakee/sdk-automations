/** An issue unlocked, so anyone may comment on it again. */

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
