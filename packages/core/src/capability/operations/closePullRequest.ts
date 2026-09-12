/**
 * A pull request closed because a clock ran out, unmerged.
 *
 * The catalogue's first close, and `clockTriggeredDestructive` for the obvious
 * reason: nobody asked for it. `reason` is the sentence the close notice
 * states, carried on the desired outcome so the change wording — and therefore
 * the journal row and the destructive warning's snapshot — names it.
 */

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
