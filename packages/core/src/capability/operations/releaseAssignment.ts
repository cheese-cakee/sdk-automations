/**
 * One named login, taken off an item's assignees because a clock ran out.
 *
 * The sibling of `unassign`, and separate from it for the reason D63 split
 * them: this release is nobody's request, so it is `clockTriggeredDestructive`
 * and reaches GitHub only through the warning-and-grace gates. The desired
 * shape lives in the catalogue with the rest of the vocabulary.
 */

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
