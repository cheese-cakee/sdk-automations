/**
 * What a capability author writes against: the declaration, its settings, the
 * facts it reads, the handle it is called through. The vocabularies are CLOSED
 * (D61) and comment identity platform-owned (D125), so it can extend neither.
 * Deliberately NOT here: the effects it returns (`../intents/`), the shared
 * vocabulary (`../catalogue.ts`), label strings and specs (`../config/`), the
 * write rules (`../safety/`), the transition tables (`../workflow/`).
 */
export * from "./producers.js";
export * from "./facts.js";
export * from "./declaration.js";
export * from "./factory.js";
export * from "./boundary.js";
export { skipped } from "./guards.js";
export {
    block,
    blocks,
    closed,
    commands,
    count,
    duration,
    DURATION_PATTERN,
    flag,
    MAX_CLOCK_HOURS,
    meanings,
    oneOf,
    parseDuration,
    principal,
    section,
    sections,
    skills,
    spec,
    text,
    texts,
    writeDuration,
    type SectionsOptions,
} from "./settings.js";
