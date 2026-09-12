/**
 * The App's own comment on an item, carrying content and purpose and no
 * marker: identity is platform-owned (D125), derived in `managed.ts` from the
 * intent's own fields and its idempotency key.
 *
 * The desired shape this operation takes lives in the catalogue, with the
 * rest of the vocabulary a capability sees.
 */

import type { OperationModule } from "./module.js";

export const postManagedComment: OperationModule<"postManagedComment"> = {
    // 6.5: comment creation duplicates on a blind retry. Not negotiable.
    facts: {
        idempotencyClass: "nonIdempotent",
        actionClassFloor: "humanFacingOutput",
        permission: "issues:write",
    },
    describeChange(subject) {
        // Capability and purpose, never the marker: the marker is derived
        // identity, and a safety record naming it would read as a value
        // someone chose rather than the change being made (D125).
        return `managed ${subject.desired.kind} comment from ${subject.capability}`;
    },
};
