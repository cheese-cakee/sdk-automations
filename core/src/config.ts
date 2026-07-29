/**
 * Repository configuration validation as pure logic —
 * `design/config/schema.md` §2–§4 as a strict, dependency-free validator.
 *
 * The input is a plain object (the YAML parse happens in the app shell,
 * which owns dependencies); this module owns the rules: unknown keys are
 * rejected (schema.md §2.7), everything defaults to off (§2.4), invalid
 * configuration fails closed (§2.6). Failing closed here means returning
 * errors and NO configuration object — there is no partially-valid config.
 */

import type { RepositoryMode } from "./safety.js";
import { CAPABILITY_NAME_PATTERN } from "./contract.js";

export const REPOSITORY_MODES = [
    "disabled",
    "observe",
    "dry-run",
    "active",
] as const;

/** The meanings a repository may map — design/core/taxonomy.md §2. */
export const MAPPABLE_MEANINGS = [
    "awaitingTriage",
    "ready",
    "inProgress",
    "needsReview",
    "needsRevision",
    "readyToMerge",
    "blocked",
] as const;
export type MappableMeaning = (typeof MAPPABLE_MEANINGS)[number];

export interface CapabilityConfig {
    readonly enabled: boolean;
    /** Opaque to the platform; validated by the capability's own contract. */
    readonly settings: Readonly<Record<string, unknown>>;
}

export interface RepositoryConfig {
    readonly schemaVersion: 1;
    readonly mode: RepositoryMode;
    readonly capabilities: Readonly<Record<string, CapabilityConfig>>;
    readonly mappings: {
        readonly labels: Partial<Readonly<Record<MappableMeaning, string>>>;
    };
    readonly principals: Readonly<Record<string, string>>;
}

/** schema.md §2.2 — no configuration causes no workflow-changing writes. */
export const NO_CONFIG: RepositoryConfig = {
    schemaVersion: 1,
    mode: "observe",
    capabilities: cleanRecord([]),
    mappings: { labels: {} },
    principals: cleanRecord([]),
};

/**
 * FINDING(config-no-config-mode): schema.md §2.2 says "no configuration
 * causes no workflow-changing writes" but does not say which *mode* an
 * unconfigured repository is in. `observe` (chosen here) satisfies the rule
 * — observe never writes — while still letting operators see findings;
 * `disabled` is the stricter reading. Register decision needed; the
 * constant above makes today's assumption explicit and greppable.
 */

export type ConfigResult =
    | { readonly ok: true; readonly config: RepositoryConfig }
    | { readonly ok: false; readonly errors: readonly string[] };

export interface ParseConfigOptions {
    /**
     * The platform's registry of shipped capability names. An *enabled*
     * capability outside the registry is a validation error;
     * a disabled unknown capability stays dormant (present, inert), so
     * removing a capability from the platform does not break configs that
     * still mention it disabled.
     *
     * FINDING(config-capability-registry-gap), experiment 6.3: without
     * this list a configuration enabling a misspelled or unshipped
     * capability passes validation silently — the maintainer believes a
     * behavior is on that does not exist. Callers that have a registry
     * REQUIRED: an absent registry used to skip the check entirely, and
     * then (2026-07-28) came to mean "no capability is known", which
     * rejects every enabled capability. Both readings are reachable by
     * forgetting an optional argument, so the argument is no longer
     * optional — a caller with no registry says so with `[]`, and the
     * fail-closed result is then a choice rather than an omission.
     */
    readonly knownCapabilities: readonly string[];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * A null-prototype record: absent-key lookups are always `undefined`.
 * With a normal prototype, `capabilities["constructor"]` would be
 * truthy for an unconfigured name — inherited Object.prototype
 * members must never masquerade as configuration.
 */
function cleanRecord<V>(entries: readonly (readonly [string, V])[]): Readonly<Record<string, V>> {
    const record: Record<string, V> = Object.create(null);
    for (const [key, value] of entries) record[key] = value;
    return record;
}

const TOP_LEVEL_KEYS = new Set([
    "schemaVersion",
    "mode",
    "capabilities",
    "mappings",
    "principals",
]);

/** Strict parse of an already-YAML-parsed value. Pure; never throws. */
export function parseConfig(raw: unknown, options: ParseConfigOptions): ConfigResult {
    if (raw === undefined || raw === null) {
        return { ok: true, config: NO_CONFIG };
    }
    const errors: string[] = [];
    if (!isPlainObject(raw)) {
        return { ok: false, errors: ["configuration must be a mapping"] };
    }

    for (const key of Object.keys(raw)) {
        if (!TOP_LEVEL_KEYS.has(key)) {
            errors.push(`unknown key "${key}" (unknown keys are rejected, schema.md §2.7)`);
        }
    }

    if (raw.schemaVersion !== 1) {
        errors.push(`schemaVersion must be 1, got ${JSON.stringify(raw.schemaVersion)}`);
    }

    /**
     * An ABSENT `mode` defaults to `observe` (§2.4, defaults are off);
     * a PRESENT but empty one is an error.
     *
     * FINDING(config-null-mode), D56: `raw.mode ?? "observe"` silently
     * accepted `mode:` with no value — YAML parses that to null — and
     * chose a mode on the maintainer's behalf. The chosen mode was the
     * safe one, but silently interpreting malformed input is the exact
     * pattern §2.7 and D38 reject everywhere else in this file.
     */
    const mode = "mode" in raw ? raw.mode : "observe";
    if (!REPOSITORY_MODES.includes(mode as RepositoryMode)) {
        errors.push(`mode must be one of ${REPOSITORY_MODES.join(", ")}, got ${JSON.stringify(raw.mode)}`);
    }

    // Entry lists, materialized via cleanRecord at the end: on a
    // null-prototype target a key like `__proto__` is an ordinary own
    // property (plain `obj[key] = value` on a normal object both
    // pollutes the prototype and silently loses the entry).
    const capabilityEntries: [string, CapabilityConfig][] = [];
    if (raw.capabilities !== undefined) {
        if (!isPlainObject(raw.capabilities)) {
            errors.push("capabilities must be a mapping");
        } else {
            for (const [name, value] of Object.entries(raw.capabilities)) {
                // A key this pattern rejects can never name a shipped
                // capability (contract.ts requires the same shape), so
                // rejecting it loses nothing and closes the hostile-key
                // hole (`__proto__`, dotted paths, etc.).
                if (!CAPABILITY_NAME_PATTERN.test(name)) {
                    errors.push(`capability name ${JSON.stringify(name)} is not a valid configuration key (camelCase)`);
                    continue;
                }
                if (!isPlainObject(value)) {
                    errors.push(`capability "${name}" must be a mapping`);
                    continue;
                }
                for (const key of Object.keys(value)) {
                    if (key !== "enabled" && key !== "settings") {
                        errors.push(`capability "${name}": unknown key "${key}"`);
                    }
                }
                // §2.4 — every capability defaults to disabled; only an
                // explicit boolean true enables ("truthy" is not consent).
                if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
                    errors.push(`capability "${name}": enabled must be a boolean`);
                }
                const settings = value.settings ?? {};
                if (!isPlainObject(settings)) {
                    errors.push(`capability "${name}": settings must be a mapping`);
                    continue;
                }
                const enabled = value.enabled === true;
                if (
                    enabled &&
                    !options.knownCapabilities.includes(name)
                ) {
                    errors.push(
                        `capability "${name}" is enabled but not in the platform's capability registry` +
                        ` (known: ${[...options.knownCapabilities].sort().join(", ") || "none"})`,
                    );
                }
                capabilityEntries.push([name, { enabled, settings }]);
            }
        }
    }

    const labels: Partial<Record<MappableMeaning, string>> = {};
    if (raw.mappings !== undefined) {
        if (!isPlainObject(raw.mappings)) {
            errors.push("mappings must be a mapping");
        } else {
            for (const key of Object.keys(raw.mappings)) {
                if (key !== "labels") errors.push(`mappings: unknown key "${key}"`);
            }
            const rawLabels = raw.mappings.labels ?? {};
            if (!isPlainObject(rawLabels)) {
                errors.push("mappings.labels must be a mapping");
            } else {
                /**
                 * FINDING(config-label-injectivity), D34: schema.md §3
                 * never defines "incompatible", so full injectivity is
                 * enforced — every meaning its own label; the
                 * observation projection relies on label→meaning being
                 * unambiguous.
                 *
                 * FINDING(config-label-case), D55: the comparison is
                 * case- and edge-whitespace-insensitive, because GitHub
                 * treats label names case-insensitively for UNIQUENESS.
                 * Exact-string comparison accepted `status: ready` and
                 * `Status: Ready` as two mappings, which is one label on
                 * GitHub — reintroducing exactly the label→meaning
                 * ambiguity D34 exists to prevent. The original spelling
                 * is preserved for writes; only the uniqueness key is
                 * folded.
                 */
                const labelOwner = new Map<string, { meaning: string; label: string }>();
                for (const [meaning, label] of Object.entries(rawLabels)) {
                    if (!MAPPABLE_MEANINGS.includes(meaning as MappableMeaning)) {
                        errors.push(`mappings.labels: "${meaning}" is not a mappable meaning`);
                        continue;
                    }
                    if (typeof label !== "string" || label.trim() === "") {
                        errors.push(`mappings.labels.${meaning}: label must be a non-empty string`);
                        continue;
                    }
                    const key = label.trim().toLowerCase();
                    const owner = labelOwner.get(key);
                    if (owner !== undefined) {
                        const sameSpelling = owner.label === label;
                        errors.push(
                            `mappings.labels: label ${JSON.stringify(label)} is mapped to both "${owner.meaning}" and "${meaning}"` +
                            (sameSpelling
                                ? ""
                                : ` (differing only in case or surrounding space from ${JSON.stringify(owner.label)}, which GitHub treats as the same label)`) +
                            ` — label mappings must be injective (schema.md §3)`,
                        );
                        continue;
                    }
                    labelOwner.set(key, { meaning, label });
                    labels[meaning as MappableMeaning] = label;
                }
            }
        }
    }

    const principalEntries: [string, string][] = [];
    if (raw.principals !== undefined) {
        if (!isPlainObject(raw.principals)) {
            errors.push("principals must be a mapping");
        } else {
            for (const [key, value] of Object.entries(raw.principals)) {
                if (typeof value !== "string") {
                    errors.push(`principals.${key}: must be a string`);
                    continue;
                }
                principalEntries.push([key, value]);
            }
        }
    }

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
            schemaVersion: 1,
            mode: mode as RepositoryMode,
            capabilities: cleanRecord(capabilityEntries),
            mappings: { labels },
            principals: cleanRecord(principalEntries),
        },
    };
}
