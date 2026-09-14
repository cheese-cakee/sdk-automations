/** An issue locked so that only maintainers may comment on it. */

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
