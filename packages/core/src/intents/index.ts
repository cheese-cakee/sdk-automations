/**
 * What an effect is once a capability has decided on it: the request, the
 * managed comment it may address, the operations it may name. Deliberately NOT
 * here: what an author declares against (`../capability`).
 */
export * from "./intent.js";
export * from "./managed.js";
export { INTENT_OPERATIONS, OPERATIONS, type OperationModule } from "./operations/index.js";
