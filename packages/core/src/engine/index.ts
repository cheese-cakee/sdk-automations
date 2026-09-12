/**
 * The engine — core's composition, owned (D92), and its only front door. A
 * shell hands `decide()` a delivery, the configuration, the enabled
 * capabilities and the few facts core cannot know, and gets back a `Report`
 * and the intents that may act.
 *
 * `events.ts` routes a delivery to the family in `normalize/` that turns it
 * into a fact record, `invoke.ts` holds the erased shape a capability is
 * called through, `change.ts` says what change one intent makes, `decide.ts`
 * is the one verb that composes them. This directory owns the WIRING, not the
 * rules: the screens are `capability/`'s, the gates `safety/`'s, the record
 * `report/`'s. A decision made here that is not "which step runs next" is in
 * the wrong place.
 *
 * NOTHING THROWS. `decide()` is total, and the fallible seams are CONTAINED
 * rather than trusted: a capability whose `evaluate` throws is a
 * `capabilityFailed` finding contributing no intents, a rejecting resolver
 * source is a `resolverFailed` finding answering `unavailable` and never an
 * empty value, a rejecting ordering lookup makes the ordering `"unknown"`,
 * which the rules already refuse (D51). Each leaves the other capabilities in
 * the run untouched, and each is a DEFECT, so each is a `problem`.
 *
 * THREE TRAPS. The caller cannot lie about the world — the safety context is
 * derived from the record, never passed in, so a shell asserting a
 * contradicting precondition has no type to assert it with (D77, D92 phase 4),
 * which is why `Externals` is as short as it is. One record is one item
 * (contracts/facts.md §4), so the projection every intent of a decision is
 * judged against is the record's own; a producer that read less than a
 * capability needs is a `factsUnread` skip rather than a guess. And `toEngine`
 * is a cast whose soundness argument lives once, in `invoke.ts`; the `never`s
 * in `decide()` are that erasure showing through.
 */
export * from "./events.js";
export * from "./decide.js";
export { describeChange, writeRequestFor } from "./change.js";
// By name, not `*`: `EngineHandle` is how the engine answers a capability,
// and a shell that could construct one could answer for it.
export { toEngine, type EngineCapability, type ResolverSource } from "./invoke.js";
