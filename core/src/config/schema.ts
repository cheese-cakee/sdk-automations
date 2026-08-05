/**
 * The reviewed repository configuration: its shape, its enumerations, and
 * the results of validating it — `design/config/schema.md` §2–§4.
 *
 * Types and constants only. The rules that check a document live in
 * `validate.ts`; the entry point that runs them lives in `parse.ts`.
 */

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
/**
 * A null-prototype record: absent-key lookups are always `undefined`.
 * With a normal prototype, `capabilities["constructor"]` would be
 * truthy for an unconfigured name — inherited Object.prototype
 * members must never masquerade as configuration.
 */
export function cleanRecord<V>(entries: readonly (readonly [string, V])[]): Readonly<Record<string, V>> {
    const record: Record<string, V> = Object.create(null);
    for (const [key, value] of entries) record[key] = value;
    return record;
}

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
