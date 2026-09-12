/**
 * The reviewed repository configuration: its vocabulary and its shape.
 * See `design/contracts/config-schema.md` §2–§4.
 *
 * Declarations only. What comes BACK from validating a document is
 * `results.ts`; the section checks are `sections.ts`; the entry point is
 * `parse.ts`.
 */

// ─── Vocabulary ──────────────────────────────────────────────────────

/** The blast-radius ladder a repository chooses from, least to most. */
export const REPOSITORY_MODES = ["disabled", "observe", "dry-run", "active"] as const;

/** Derived from the array, so a new mode needs no edit anywhere else (D76). */
export type RepositoryMode = (typeof REPOSITORY_MODES)[number];

/** The meanings a repository may map. See design/contracts/taxonomy.md §2. */
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

/**
 * The commands a repository may give a spelling to. A command is a comment a
 * contributor types, so the platform names the ACT and the file names the
 * word — `/assign`, `/take`, whatever the repository already says.
 */
export const COMMANDS = ["assign", "unassign", "working"] as const;
export type Command = (typeof COMMANDS)[number];

/**
 * The skill ladder, easiest first. The ORDER is the contract: a capability
 * gating a tier compares by index, so a tier's place in this array is what
 * "above beginner" means (D127).
 */
export const SKILL_TIERS = ["goodFirstIssue", "beginner", "intermediate", "advanced"] as const;
export type Skill = (typeof SKILL_TIERS)[number];

export const ENTITY_KINDS = ["issue", "pullRequest"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

/** `blocked` is a flag rather than a position, so its flow is `pause` (D28). */
export type MeaningFlow = EntityKind | "pause";

/**
 * Which flow each meaning belongs to. `workflow/positions.ts` builds the
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
 * config-schema.md §3). One shape covers both ends: `declaration.ts` checks shipped
 * names, `validate.ts` checks the keys it reads from a document.
 */
export const CAPABILITY_NAME_PATTERN = /^[a-z][a-zA-Z0-9]*$/;

// ─── The shape of a document ─────────────────────────────────────────

/** One capability's block in a configuration file. */
export interface CapabilityConfig {
    readonly enabled: boolean;
    /** Opaque to the platform. The capability's own contract validates it. */
    readonly settings: Readonly<Record<string, unknown>>;
}

/**
 * How a repository spells one entry of an OPEN family. The label form only.
 *
 * An object rather than the bare string a closed family uses, because an open
 * family's meanings are the repository's and the platform cannot know in
 * advance that a label is the only way to carry one. `notifications`' design
 * also states a native form — `{ field: Priority, value: Critical }` — and it
 * is NOT here: reading an issue's project-field values is that design's phase
 * 2 and needs an endpoint the matrix has not confirmed. The validator names
 * the phase rather than accepting a shape nothing downstream could read.
 */
export interface OpenMappingSpelling {
    readonly label: string;
}

/**
 * The mapping families, each meaning → the spelling this repository chose for
 * it. Every family is present and possibly empty, so "mapped nothing" and "has
 * no such family" are not the same absence.
 *
 * The first three are CLOSED: the platform names the meanings and a repository
 * chooses the words. `alerts` and `types` are OPEN — the repository names the
 * meanings too, because neither has any meaning to the platform beyond "some
 * capability's settings may name it". That is why both are typed with a
 * `string` key, why both are absent from `MAPPING_FAMILIES`, and why no
 * declaration can require one of their entries: there is no closed set for
 * `requiredMappings` to be checked against.
 */
export interface Mappings {
    readonly labels: Partial<Readonly<Record<MappableMeaning, string>>>;
    readonly commands: Partial<Readonly<Record<Command, string>>>;
    readonly skills: Partial<Readonly<Record<Skill, string>>>;
    readonly alerts: Readonly<Record<string, OpenMappingSpelling>>;
    readonly types: Readonly<Record<string, OpenMappingSpelling>>;
}

/**
 * The CLOSED mapping families, in the order errors surface. Adding a family to
 * `Mappings` does not admit it here; only the reverse is a compile error.
 *
 * This is the list `requiredMappings` is checked against and the list each
 * family's closed meaning set is keyed by — so an open-keyed family must not
 * join it. `MAPPING_SECTION_KEYS` is the separate question of what the
 * `mappings:` section admits.
 */
export const MAPPING_FAMILIES = [
    "labels",
    "commands",
    "skills",
] as const satisfies readonly (keyof Mappings)[];
export type MappingFamily = (typeof MAPPING_FAMILIES)[number];

/** The open-keyed families: the repository names the meanings as well. */
export const OPEN_MAPPING_FAMILIES = [
    "alerts",
    "types",
] as const satisfies readonly (keyof Mappings)[];
export type OpenMappingFamily = (typeof OPEN_MAPPING_FAMILIES)[number];

/**
 * Every key the `mappings:` section admits — both kinds of family. Split from
 * `MAPPING_FAMILIES` because the two lists answer different questions, and one
 * list answering both is what would let an open family reach a check that
 * needs a closed meaning set.
 */
export const MAPPING_SECTION_KEYS = [
    ...MAPPING_FAMILIES,
    ...OPEN_MAPPING_FAMILIES,
] as const satisfies readonly (keyof Mappings)[];
export type MappingSectionKey = (typeof MAPPING_SECTION_KEYS)[number];

/**
 * A validated configuration, plus the revision it was read from.
 *
 * `revision` is the sha of the file, and the one field nobody writes: the
 * shell supplies it through `ParseConfigOptions` and records it in reports.
 * Any future write path must bind work to this revision (D45, D77).
 */
export interface RepositoryConfig {
    readonly revision: string;
    readonly schemaVersion: 1;
    readonly mode: RepositoryMode;
    readonly capabilities: Readonly<Record<string, CapabilityConfig>>;
    readonly mappings: Mappings;
    readonly principals: Readonly<Record<string, string>>;
}

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

// ─── Parsing input ───────────────────────────────────────────────────

/**
 * What must be mapped, by family, before a capability may be enabled (D84).
 *
 * An absent family demands nothing, which is why each key is optional rather
 * than an empty array: a capability that needs `mappings.commands.assign` and
 * no label at all should not have to write two empty lists to say so.
 */
export interface RequiredMappings {
    readonly labels?: readonly MappableMeaning[];
    readonly commands?: readonly Command[];
    readonly skills?: readonly Skill[];
}

/**
 * One admitted capability, as much of it as the parser can use.
 *
 * The fields are exactly the two a `CapabilityDeclaration` states about
 * CONFIGURATION, so a declaration is an admission with no adapting: the
 * shell may pass its declarations straight through. Everything else a
 * declaration says — triggers, observations, resolvers, intents — is about
 * running, and a document cannot be wrong about it.
 */
export interface AdmittedCapability {
    readonly name: string;
    /** The legal `settings` key names. Any other is `unknownKey` (D84). */
    readonly configKeys: readonly string[];
    /** What must be mapped before this may be enabled (D84). */
    readonly requiredMappings: RequiredMappings;
}

/**
 * What the caller knows that the document does not say.
 *
 * `knownCapabilities` is the application's directly admitted list. Any
 * capability outside it is an error, whether enabled or disabled. The field is
 * required because omitting the admission authority would silently skip the
 * unknown-capability check (D58).
 *
 * An entry may be a bare NAME or an `AdmittedCapability`. A name admits the
 * name and states nothing else, so the two checks that need more than a name —
 * settings keys and required mappings — do not run for it. That is the honest
 * reading: treating "nothing declared" as "no legal settings key" would reject
 * every block a name-only caller admits.
 */
export interface ParseConfigOptions {
    /** The revision of the document being parsed. See `RepositoryConfig`. */
    readonly revision: string;
    readonly knownCapabilities: readonly (string | AdmittedCapability)[];
}
