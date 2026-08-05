/**
 * `parseConfig` — the one entry point, and the order a maintainer reads
 * their mistakes in.
 */

import {
    cleanRecord,
    NO_CONFIG,
    type ConfigResult,
    type ParseConfigOptions,
    type RepositoryMode,
} from "./schema.js";
import {
    checkSchemaVersion,
    checkTopLevelKeys,
    isPlainObject,
    parseCapabilities,
    parseMappings,
    parseMode,
    parsePrincipals,
} from "./validate.js";

export function parseConfig(raw: unknown, options: ParseConfigOptions): ConfigResult {
    if (raw === undefined || raw === null) {
        return { ok: true, config: { ...NO_CONFIG, revision: options.revision } };
    }
    if (!isPlainObject(raw)) {
        return { ok: false, errors: ["configuration must be a mapping"] };
    }

    const mode = parseMode(raw);
    const capabilities = parseCapabilities(raw, options.knownCapabilities);
    const mappings = parseMappings(raw);
    const principals = parsePrincipals(raw);

    const errors = [
        ...checkTopLevelKeys(raw),
        ...checkSchemaVersion(raw),
        ...mode.errors,
        ...capabilities.errors,
        ...mappings.errors,
        ...principals.errors,
    ];

    /**
     * §2.6 — fail closed: any error yields no configuration at all.
     * FINDING(config-fail-closed-granularity), D38: the granularity is
     * deliberately the WHOLE file — last-known-good and partial
     * salvage were both rejected (see the register row). Humane only
     * with the shell's two mitigations: the configuration report and
     * PR-time validation via this same function.
     */
    if (errors.length > 0) return { ok: false, errors };

    return {
        ok: true,
        config: {
            revision: options.revision,
            schemaVersion: 1,
            mode: mode.value as RepositoryMode,
            capabilities: cleanRecord(capabilities.value),
            mappings: { labels: mappings.value },
            principals: cleanRecord(principals.value),
        },
    };
}
