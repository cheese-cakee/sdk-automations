/** The contract one operation's module fills — write-operations.md §2. */

import type { IntentCatalogue, IntentOperation, OperationFacts } from "../../catalogue.js";

export interface ChangeSubject<K extends IntentOperation> {
    readonly capability: string;
    readonly desired: IntentCatalogue[K];
}

export interface OperationModule<K extends IntentOperation> {
    /** Idempotency class, action-class floor, permission (D62). */
    readonly facts: OperationFacts;
    /** Pinned wording: the slice parity test compares it literally. */
    describeChange(subject: ChangeSubject<K>): string;
}
