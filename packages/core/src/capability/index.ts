/**
 * The capability layer: what a capability may declare, and how it is called.
 *
 * The vocabularies are CLOSED (D61) and comment identity is platform-owned
 * (D125), so a capability can extend neither. Deliberately NOT here: label
 * strings (`../config/`), the write rules (`../safety/`), the transition
 * tables (`../workflow/`), and the capabilities themselves.
 */
export * from "./catalogue.js";
export * from "./producers.js";
export * from "./facts.js";
export { INTENT_OPERATIONS } from "./operations/index.js";
export * from "./managed.js";
export * from "./declaration.js";
export * from "./intent.js";
export * from "./factory.js";
export * from "./boundary.js";
export { skipped } from "./guards.js";
export {
    describeSpec,
    readSettings,
    type BlockOf,
    type DurationOptions,
    type Field,
    type FieldDescription,
    type SettingsOf,
    type SettingsProblem,
    type SettingsProblemCode,
    type SettingsResult,
    type SettingsView,
    type Spec,
} from "./spec.js";
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
