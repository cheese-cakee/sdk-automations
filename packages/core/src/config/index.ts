/**
 * The configuration layer: what a repository asked for
 * (`design/contracts/config-schema.md` §2–§4). Nothing here throws or does
 * I/O, and one error anywhere yields no configuration at all (D38).
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
export type { ConfigError, ConfigErrorCode, ConfigResult } from "./results.js";
export { parseConfig, NO_CONFIG } from "./parse.js";
export { parseConfigDocument } from "./document.js";
export {
    alertsOfLabels,
    commandInComment,
    labelKey,
    meaningOfLabel,
    meaningsOfLabels,
} from "./labels.js";
