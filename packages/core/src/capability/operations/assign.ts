/**
 * One named login, added to an item's assignees at that person's own request.
 *
 * The counterpart of `unassign`, and `reversibleStateChange` for the reason
 * that operation is: the contributor asked, and the same contributor's
 * `/unassign` undoes it exactly. Nothing here is clock-triggered, so no grace
 * terms may ride on it (D63, and `screenGrace` refuses both mistakes).
 *
 * The desired shape lives in the catalogue, with the rest of the vocabulary a
 * capability sees.
 */

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
