/**
 * What a capability author writes against: declaration, settings, facts, the
 * handle it is called through. Closed (D61); comment identity is platform-owned
 * (D125). Not here: effects (`../intents/`), the shared vocabulary
 * (`../catalogue.ts`), config (`../config/`), safety (`../safety/`), workflow (`../workflow/`).
 */
export * from "./producers.js";
export * from "./facts.js";
export * from "./declaration.js";
export * from "./factory.js";
export * from "./boundary.js";
export { skipped } from "./guards.js";
export {
    block,
    duration,
    DURATION_PATTERN,
    flag,
    MAX_CLOCK_HOURS,
    meanings,
    parseDuration,
    section,
    spec,
    text,
    writeDuration,
} from "./settings.js";
