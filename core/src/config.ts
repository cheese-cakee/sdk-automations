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

import { CAPABILITY_NAME_PATTERN } from "./contract.js";

export const REPOSITORY_MODES = [
    "disabled",
    "observe",
    "dry-run",
    "active",
] as const;

/**
 * Derived, never restated. `MAPPABLE_MEANINGS` two declarations below has
 * always done this; the mode did not, and kept its union hand-written in
 * `safety.ts` — the same four strings in two files with nothing linking
 * them, and a `value as RepositoryMode` cast in this file quietly covering
 * the seam. Adding a mode to the array alone would have let `parseConfig`
 * accept a value the safety engine's type had never heard of.
 *
 * FINDING(config-mode-union-derived), D76 — the fifth sighting of one fact
 * stored twice, after D53, D62, D67 and D73.
 */
export type RepositoryMode = (typeof REPOSITORY_MODES)[number];

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
    if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
    const prototype = Object.getPrototypeOf(v);
    return prototype === Object.prototype || prototype === null;
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

/**
 * One configuration section's outcome: the value it contributes, and the
 * problems it found. Sections never throw and never short-circuit each
 * other — a maintainer with three mistakes should be told about all
 * three, not made to fix them one push at a time.
 */
interface Section<T> {
    readonly value: T;
    readonly errors: readonly string[];
}

/** schema.md §2.7 — unknown top-level keys are rejected, never ignored. */
function checkTopLevelKeys(raw: Record<string, unknown>): readonly string[] {
    return Object.keys(raw)
        .filter((key) => !TOP_LEVEL_KEYS.has(key))
        .map((key) => `unknown key "${key}" (unknown keys are rejected, schema.md §2.7)`);
}

/**
 * D31's migration policy in one line: any version but 1 is rejected
 * whole. Migration tooling waits until a version 2 exists to migrate to.
 */
function checkSchemaVersion(raw: Record<string, unknown>): readonly string[] {
    return raw.schemaVersion === 1
        ? []
        : [`schemaVersion must be 1, got ${JSON.stringify(raw.schemaVersion)}`];
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
function parseMode(raw: Record<string, unknown>): Section<unknown> {
    const value = Object.hasOwn(raw, "mode") ? raw.mode : "observe";
    return {
        value,
        errors: REPOSITORY_MODES.includes(value as RepositoryMode)
            ? []
            : [`mode must be one of ${REPOSITORY_MODES.join(", ")}, got ${JSON.stringify(raw.mode)}`],
    };
}

/**
 * Entries rather than an object: they are materialized via `cleanRecord`
 * at the end, because on a null-prototype target a key like `__proto__`
 * is an ordinary own property (plain `obj[key] = value` on a normal
 * object both pollutes the prototype and silently loses the entry).
 */
function parseCapabilities(
    raw: Record<string, unknown>,
    knownCapabilities: readonly string[],
): Section<[string, CapabilityConfig][]> {
    const entries: [string, CapabilityConfig][] = [];
    const errors: string[] = [];
    if (raw.capabilities === undefined) return { value: entries, errors };
    if (!isPlainObject(raw.capabilities)) {
        return { value: entries, errors: ["capabilities must be a mapping"] };
    }

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
        if (enabled && !knownCapabilities.includes(name)) {
            errors.push(
                `capability "${name}" is enabled but not in the platform's capability registry` +
                ` (known: ${[...knownCapabilities].sort().join(", ") || "none"})`,
            );
        }
        entries.push([name, { enabled, settings }]);
    }
    return { value: entries, errors };
}

/**
 * FINDING(config-label-injectivity), D34: schema.md §3 never defines
 * "incompatible", so full injectivity is enforced — every meaning its
 * own label; the observation projection relies on label→meaning being
 * unambiguous.
 *
 * FINDING(config-label-case), D55: the comparison is case- and
 * edge-whitespace-insensitive, because GitHub treats label names
 * case-insensitively for UNIQUENESS. Exact-string comparison accepted
 * `status: ready` and `Status: Ready` as two mappings, which is one
 * label on GitHub — reintroducing exactly the label→meaning ambiguity
 * D34 exists to prevent. The original spelling is preserved for writes;
 * only the uniqueness key is folded.
 */
function parseMappings(
    raw: Record<string, unknown>,
): Section<Partial<Record<MappableMeaning, string>>> {
    const labels: Partial<Record<MappableMeaning, string>> = {};
    const errors: string[] = [];
    if (raw.mappings === undefined) return { value: labels, errors };
    if (!isPlainObject(raw.mappings)) {
        return { value: labels, errors: ["mappings must be a mapping"] };
    }

    for (const key of Object.keys(raw.mappings)) {
        if (key !== "labels") errors.push(`mappings: unknown key "${key}"`);
    }
    const rawLabels = raw.mappings.labels ?? {};
    if (!isPlainObject(rawLabels)) {
        errors.push("mappings.labels must be a mapping");
        return { value: labels, errors };
    }

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
    return { value: labels, errors };
}

function parsePrincipals(raw: Record<string, unknown>): Section<[string, string][]> {
    const entries: [string, string][] = [];
    const errors: string[] = [];
    if (raw.principals === undefined) return { value: entries, errors };
    if (!isPlainObject(raw.principals)) {
        return { value: entries, errors: ["principals must be a mapping"] };
    }
    for (const [key, value] of Object.entries(raw.principals)) {
        if (typeof value !== "string") {
            errors.push(`principals.${key}: must be a string`);
            continue;
        }
        entries.push([key, value]);
    }
    return { value: entries, errors };
}

/**
 * Strict parse of an already-YAML-parsed value. Pure; never throws.
 *
 * The section order below is the ERROR order a maintainer sees, and the
 * tests freeze it: top-level keys, version, mode, capabilities,
 * mappings, principals — outermost problem first.
 */
export function parseConfig(raw: unknown, options: ParseConfigOptions): ConfigResult {
    if (raw === undefined || raw === null) {
        return { ok: true, config: NO_CONFIG };
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
            schemaVersion: 1,
            mode: mode.value as RepositoryMode,
            capabilities: cleanRecord(capabilities.value),
            mappings: { labels: mappings.value },
            principals: cleanRecord(principals.value),
        },
    };
}
