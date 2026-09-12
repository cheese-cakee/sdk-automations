/**
 * The item's position, SET rather than added: the adapter removes the
 * position label the item previously held as part of realising it (D4).
 *
 * The desired shape this operation takes lives in the catalogue, with the
 * rest of the vocabulary a capability sees — including why its `cause` comes
 * from the closed, entity-scoped list rather than free text.
 */

import type { OperationModule } from "./module.js";

export const applyMappedLabel: OperationModule<"applyMappedLabel"> = {
    facts: {
        idempotencyClass: "idempotent",
        actionClassFloor: "reversibleStateChange",
        permission: "issues:write",
    },
    describeChange(subject) {
        // "set", not "add": the adapter swaps the previous position
        // label as part of realising this (D4, D80).
        return `set mapped position ${subject.desired.meaning}`;
    },
};
