/**
 * The contract one operation's module fills — write-operations.md §2.
 *
 * A module is the platform's whole answer about one operation: the facts it
 * owns, and the words its change is recorded in. `index.ts` registers them.
 * Nothing in this directory reaches the screens or the engine.
 *
 * `describeChange` is declared as a METHOD rather than a function-typed
 * property, so a module for one `K` stays assignable where the registry's
 * union is called — the same bivariance the engine already relies on.
 */

import type { IntentCatalogue, IntentOperation, OperationFacts } from "../catalogue.js";

/** The change one intent of this operation makes — the fields `describeChange` may read. */
export interface ChangeSubject<K extends IntentOperation> {
    readonly capability: string;
    readonly desired: IntentCatalogue[K];
}

/** What the platform owns about one operation: its facts, and its change wording. */
export interface OperationModule<K extends IntentOperation> {
    /** The platform's facts: idempotency class, action-class floor, permission (D62). */
    readonly facts: OperationFacts;
    /** contracts/safety.md's exact item-and-value wording; pinned by the slice parity test. */
    describeChange(subject: ChangeSubject<K>): string;
}
