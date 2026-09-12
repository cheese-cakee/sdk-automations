/** The item's position, SET rather than added — the adapter removes the previous one (D4). */

import type { OperationModule } from "./module.js";

export const applyMappedLabel: OperationModule<"applyMappedLabel"> = {
    facts: {
        idempotencyClass: "idempotent",
        actionClassFloor: "reversibleStateChange",
        permission: "issues:write",
    },
    describeChange(subject) {
        return `set mapped position ${subject.desired.meaning}`;
    },
};
