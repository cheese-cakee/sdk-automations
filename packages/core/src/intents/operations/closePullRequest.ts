/** A pull request closed because a clock ran out, unmerged. */

import type { OperationModule } from "./module.js";

export const closePullRequest: OperationModule<"closePullRequest"> = {
    facts: {
        idempotencyClass: "idempotent",
        actionClassFloor: "clockTriggeredDestructive",
        permission: "pull_requests:write",
    },
    describeChange(subject) {
        return `close pull request: ${subject.desired.reason}`;
    },
};
