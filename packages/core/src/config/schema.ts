/**
 * The reviewed repository configuration: its shape, its enumerations, and the
 * results of validating it. See `design/config/schema.md` §2–§4.
 *
 * Types and constants only. The rules that check a document live in
 * `validate.ts`. The entry point that runs them lives in `parse.ts`.
 */

/** The blast-radius ladder a repository chooses from, least to most. */
export const REPOSITORY_MODES = [
    "disabled",
    "observe",
    "dry-run",
    "active",
] as const;

/** Derived from the array, so a new mode needs no edit anywhere else (D76). */
export type RepositoryMode = (typeof REPOSITORY_MODES)[number];

/** The meanings a repository may map. See design/core/taxonomy.md §2. */
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

export const ENTITY_KINDS = ["issue", "pullRequest"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

/** `blocked` is a flag rather than a position, so its flow is `pause` (D28). */
export type MeaningFlow = EntityKind | "pause";

/**
 * Which flow each meaning belongs to. `workflow/meanings.ts` builds the
 * per-entity position types from this table by matching on the flow values,
 * so those values have to stay literal.
 *
 * That is what `satisfies` protects. A `:` annotation would type every `flow`
 * as the whole `MeaningFlow` union instead of `"issue"` or `"pullRequest"`.
 * Nothing would match, both derived unions would become `never`, and this
 * line would still compile (D90).
 */
export const MEANING_FACTS = {
    awaitingTriage: { flow: "issue" },
    ready: { flow: "issue" },
    inProgress: { flow: "issue" },
    needsReview: { flow: "pullRequest" },
    needsRevision: { flow: "pullRequest" },
    readyToMerge: { flow: "pullRequest" },
    blocked: { flow: "pause" },
} as const satisfies {
    readonly [K in MappableMeaning]: { readonly flow: MeaningFlow };
};

/**
 * Capability names double as configuration keys (`capabilities.<name>`,
 * schema.md §3). One shape covers both ends: `declaration.ts` checks shipped
 * names, `validate.ts` checks the keys it reads from a document.
 */
export const CAPABILITY_NAME_PATTERN = /^[a-z][a-zA-Z0-9]*$/;

/**
 * The keys a document may carry, in the order a maintainer meets them.
 * `revision` is excluded: the parser stamps it, nobody writes it (D77).
 *
 * Adding a field to `RepositoryConfig` does not add it here. Only the reverse
 * is a compile error.
 */
export const TOP_LEVEL_KEYS = [
    "schemaVersion",
    "mode",
    "capabilities",
    "mappings",
    "principals",
] as const satisfies readonly (keyof Omit<RepositoryConfig, "revision">)[];
export type TopLevelKey = (typeof TOP_LEVEL_KEYS)[number];

/** One capability's block in a configuration file. */
export interface CapabilityConfig {
    readonly enabled: boolean;
    /** Opaque to the platform. The capability's own contract validates it. */
    readonly settings: Readonly<Record<string, unknown>>;
}

/**
 * A validated configuration, plus the revision it was read from.
 *
 * `revision` is the sha of the file, and the one field nobody writes: the
 * shell supplies it through `ParseConfigOptions`. The executor guards
 * in-flight effects on it, so an intent from an older revision cannot
 * resume (D45, D77).
 */
export interface RepositoryConfig {
    readonly revision: string;
    readonly schemaVersion: 1;
    readonly mode: RepositoryMode;
    readonly capabilities: Readonly<Record<string, CapabilityConfig>>;
    readonly mappings: {
        readonly labels: Partial<Readonly<Record<MappableMeaning, string>>>;
    };
    readonly principals: Readonly<Record<string, string>>;
}

/**
 * A null-prototype record, so a key nobody set always reads `undefined`.
 * Otherwise `capabilities["constructor"]` is truthy for a capability that
 * does not exist.
 */
export function cleanRecord<V>(entries: readonly (readonly [string, V])[]): Readonly<Record<string, V>> {
    const record: Record<string, V> = Object.create(null);
    for (const [key, value] of entries) record[key] = value;
    return record;
}

/**
 * What a repository with no configuration file gets. schema.md §2.2 says no
 * configuration causes no workflow-changing writes.
 *
 * FINDING(config-no-config-mode): §2.2 does not say which mode that is.
 * `observe` obeys the rule and still shows findings. `disabled` is the
 * stricter reading. Undecided, and this constant is where the assumption sits.
 */
export const NO_CONFIG: RepositoryConfig = {
    revision: "",
    schemaVersion: 1,
    mode: "observe",
    capabilities: cleanRecord([]),
    mappings: { labels: {} },
    principals: cleanRecord([]),
};

/** Why a configuration was rejected, in a form a report can use (D75). */
export type ConfigErrorCode =
    /** Document-level. Only `parseConfigDocument` sees text, so only it
     * reports these. */
    | "documentUnparseable"
    | "duplicateKey"
    | "notAMapping"
    | "unknownKey"
    | "schemaVersionUnsupported"
    | "modeInvalid"
    | "capabilityNameInvalid"
    | "capabilityEnabledNotBoolean"
    | "capabilityNotInRegistry"
    | "meaningNotMappable"
    | "labelInvalid"
    | "labelNotInjective"
    | "principalNotAString";

/**
 * One reason a document was rejected.
 *
 * `path` is dotted, like `capabilities.intake.enabled`, or `null` for a
 * whole-document problem. A check run uses it to annotate one line instead
 * of pasting a paragraph.
 */
export interface ConfigError {
    readonly code: ConfigErrorCode;
    /** For a maintainer. Never asserted on, only its presence. */
    readonly message: string;
    readonly path: string | null;
}

/** Parsed, or rejected with reasons. Never both. */
export type ConfigResult =
    | { readonly ok: true; readonly config: RepositoryConfig }
    | { readonly ok: false; readonly errors: readonly ConfigError[] };

/**
 * What the caller knows that the document does not say.
 *
 * `knownCapabilities` is the platform's shipped names. An enabled capability
 * outside the list is an error; a disabled one is not, so retiring a
 * capability never breaks a configuration that still names it. It is
 * required rather than optional because an absent registry used to mean both
 * "skip the check" and "nothing is known", and forgetting the argument
 * reached either one (D58).
 */
export interface ParseConfigOptions {
    /** The revision of the document being parsed. See `RepositoryConfig`. */
    readonly revision: string;
    readonly knownCapabilities: readonly string[];
}
