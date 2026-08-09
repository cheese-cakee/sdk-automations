/**
 * The engine — core's composition, owned (D92). See [README.md](README.md).
 *
 * `events.ts` turns a delivery into an observation, `invoke.ts` holds the
 * erased shape a capability is called through, `decide.ts` is the one verb
 * that composes them.
 */
export * from "./events.js";
export * from "./decide.js";
// By name, not `*`: `EngineHandle` is how the engine answers a capability,
// and a shell that could construct one could answer for it.
export { toEngine, type EngineCapability, type ResolverSource } from "./invoke.js";
