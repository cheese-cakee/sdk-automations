/** The App's own comment on an item, carrying no marker: identity is platform-owned (D125). */

import type { OperationModule } from "./module.js";

export const postManagedComment: OperationModule<"postManagedComment"> = {
    // 6.5: comment creation duplicates on a blind retry. Not negotiable.
    facts: {
        idempotencyClass: "nonIdempotent",
        actionClassFloor: "humanFacingOutput",
        permission: "issues:write",
    },
    describeChange(subject) {
        return `managed ${subject.desired.kind} comment from ${subject.capability}`;
    },
};
