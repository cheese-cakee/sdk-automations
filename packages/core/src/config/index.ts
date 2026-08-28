/**
 * The configuration layer: what a repository asked for.
 *
 * `schema.ts` is the vocabulary and shape, `results.ts` what comes back,
 * `sections.ts` the per-section rules, `parse.ts` the entry point,
 * `document.ts` the YAML, `labels.ts` the reverse lookup. This barrel exists
 * so consumers name the CONCERN rather than the file inside it.
 */
export * from "./schema.js";
export {
    ABSENT_CONFIG_REVISION,
    CONFIG_PATH,
    UNREADABLE_CONFIG_REVISION,
    revisionOf,
    type ConfigDocument,
    type ConfigLoadOutcome,
    type ConfigSource,
} from "./source.js";
// By name, not `*`: `Checked` is how sections speak to each other and is not
// part of core's public surface.
export type { ConfigError, ConfigErrorCode, ConfigResult } from "./results.js";
export { parseConfig, NO_CONFIG } from "./parse.js";
export { parseConfigDocument } from "./document.js";
export { labelKey, meaningOfLabel, meaningsOfLabels } from "./labels.js";
