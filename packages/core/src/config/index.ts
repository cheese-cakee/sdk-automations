/**
 * The configuration layer: what a repository asked for — the rules of
 * `design/contracts/config-schema.md` §2–§4 as code.
 *
 * `schema.ts` is the vocabulary and shape, `results.ts` what comes back,
 * `sections.ts` the per-section rules, `parse.ts` the entry point,
 * `document.ts` the YAML, `labels.ts` the reverse lookup. This barrel exists
 * so consumers name the CONCERN rather than the file inside it.
 *
 * Two properties hold throughout, and most of the design follows from them.
 * NOTHING HERE THROWS AND NOTHING DOES I/O: the shell reads the bytes, this
 * layer is text in, result out, and every rejection is a returned value. It
 * FAILS CLOSED, WHOLE-FILE: one error anywhere yields no configuration at all,
 * never a partial one (D38), but every error is collected first so a
 * maintainer with three mistakes is told about all three. `document.ts` is the
 * only file that knows YAML exists, which is where that dependency stays
 * quarantined; `labels.ts` is not part of the parse at all and runs once per
 * delivery.
 *
 * Three prefixes, three jobs (D103): `parse*` are the two entry points and the
 * only things that turn one representation into another, `read*` is one
 * section reader returning a `Checked<T>` — a value or problems, never both —
 * and `check*` returns problems only, for the sections contributing nothing.
 * The trap: `readMappings` is in `sections.ts`, not `labels.ts`. It validates
 * the `mappings:` block; `labels.ts` answers the opposite direction, which
 * meaning a label on the wire carries. Same word, two directions.
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
export {
    alertsOfLabels,
    commandInComment,
    labelKey,
    meaningOfLabel,
    meaningsOfLabels,
} from "./labels.js";
