/**
 * The section validators — one per thing a configuration document has.
 *
 * Every validator is total and independent. None throws, none short-circuits
 * another, and each returns the value it contributes alongside the problems
 * it found. So a maintainer with three mistakes is told about all three,
 * rather than made to fix them one push at a time — the humane half of D38's
 * whole-file fail-closed rule.

 * `check*` returns problems only. `read*` returns a value as well, wrapped
 * in `Checked` — see `results.ts`.
 */

import { checked, err, type Checked, type ConfigError, type ConfigErrorCode } from "./results.js";
import { labelKey } from "./labels.js";
import {
    CAPABILITY_NAME_PATTERN,
    COMMANDS,
    MAPPABLE_MEANINGS,
    MAPPING_FAMILIES,
    MAPPING_SECTION_KEYS,
    REPOSITORY_MODES,
    SKILL_TIERS,
    TOP_LEVEL_KEYS,
    type AdmittedCapability,
    type CapabilityConfig,
    type Command,
    type MappableMeaning,
    type Mappings,
    type OpenMappingSpelling,
    type RepositoryMode,
    type Skill,
} from "./schema.js";

export function isPlainObject(v: unknown): v is Record<string, unknown> {
    if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
    const prototype = Object.getPrototypeOf(v);
    return prototype === Object.prototype || prototype === null;
}

// ─── Section readers, in the order errors surface ────────────────────

const KNOWN_TOP_LEVEL = new Set<string>(TOP_LEVEL_KEYS);

/** config-schema.md §3 — unknown top-level keys are rejected, never ignored. */
export function checkTopLevelKeys(raw: Record<string, unknown>): readonly ConfigError[] {
    return Object.keys(raw)
        .filter((key) => !KNOWN_TOP_LEVEL.has(key))
        .map((key) =>
            err(
                "unknownKey",
                `unknown key "${key}" (unknown keys are rejected, config-schema.md §3)`,
                key,
            ),
        );
}

/**
 * D31's migration policy in one line: any version but 1 is rejected
 * whole. Migration tooling waits until a version 2 exists to migrate to.
 */
export function checkSchemaVersion(raw: Record<string, unknown>): readonly ConfigError[] {
    return raw.schemaVersion === 1
        ? []
        : [
              err(
                  "schemaVersionUnsupported",
                  `schemaVersion must be 1, got ${JSON.stringify(raw.schemaVersion)}`,
                  "schemaVersion",
              ),
          ];
}

/**
 * A predicate rather than an assertion. The array is widened to
 * `readonly string[]`, which is always safe; asserting the unknown value to
 * be a mode is the unsound direction.
 */
function isRepositoryMode(value: unknown): value is RepositoryMode {
    return typeof value === "string" && (REPOSITORY_MODES as readonly string[]).includes(value);
}

/**
 * An absent `mode` defaults to `observe` (§2.4). A present but empty one is
 * an error: `mode:` with no value parses to null, and choosing a mode on the
 * maintainer's behalf is the silent interpretation §2.7 rejects (D56).
 */
export function readMode(raw: Record<string, unknown>): Checked<RepositoryMode> {
    const value = Object.hasOwn(raw, "mode") ? raw.mode : "observe";
    return isRepositoryMode(value)
        ? { ok: true, value }
        : {
              ok: false,
              errors: [
                  err(
                      "modeInvalid",
                      `mode must be one of ${REPOSITORY_MODES.join(", ")}, got ${JSON.stringify(raw.mode)}`,
                      "mode",
                  ),
              ],
          };
}

/**
 * The admission list as a lookup: every admitted name, mapped to what the
 * caller said about it. A `Map` rather than a record, so a capability named
 * `constructor` is a key like any other.
 *
 * `null` is a NAME-ONLY admission — see `ParseConfigOptions`. The two checks
 * that need a declaration skip those entries; `capabilityUnknown` does not,
 * because a name is all that check ever needed.
 */
function admissionsOf(
    known: readonly (string | AdmittedCapability)[],
): Map<string, AdmittedCapability | null> {
    const admitted = new Map<string, AdmittedCapability | null>();
    for (const entry of known) {
        if (typeof entry === "string") admitted.set(entry, null);
        else admitted.set(entry.name, entry);
    }
    return admitted;
}

/**
 * Entries rather than an object: they are materialized via `cleanRecord`
 * at the end, because on a null-prototype target a key like `__proto__`
 * is an ordinary own property (plain `obj[key] = value` on a normal
 * object both pollutes the prototype and silently loses the entry).
 */
export function readCapabilities(
    raw: Record<string, unknown>,
    knownCapabilities: readonly (string | AdmittedCapability)[],
): Checked<[string, CapabilityConfig][]> {
    const entries: [string, CapabilityConfig][] = [];
    const errors: ConfigError[] = [];
    if (raw.capabilities === undefined) return { ok: true, value: entries };
    if (!isPlainObject(raw.capabilities)) {
        return {
            ok: false,
            errors: [err("notAMapping", "capabilities must be a mapping", "capabilities")],
        };
    }
    const admitted = admissionsOf(knownCapabilities);

    for (const [name, value] of Object.entries(raw.capabilities)) {
        // A key this pattern rejects can never name a shipped
        // capability (contract.ts requires the same shape), so
        // rejecting it loses nothing and closes the hostile-key
        // hole (`__proto__`, dotted paths, etc.).
        if (!CAPABILITY_NAME_PATTERN.test(name)) {
            errors.push(
                err(
                    "capabilityNameInvalid",
                    `capability name ${JSON.stringify(name)} is not a valid configuration key (camelCase)`,
                    `capabilities.${name}`,
                ),
            );
            continue;
        }
        if (!isPlainObject(value)) {
            errors.push(
                err(
                    "notAMapping",
                    `capability "${name}" must be a mapping`,
                    `capabilities.${name}`,
                ),
            );
            continue;
        }
        for (const key of Object.keys(value)) {
            if (key !== "enabled" && key !== "settings") {
                errors.push(
                    err(
                        "unknownKey",
                        `capability "${name}": unknown key "${key}"`,
                        `capabilities.${name}.${key}`,
                    ),
                );
            }
        }
        // §2.4 — every capability defaults to disabled; only an
        // explicit boolean true enables ("truthy" is not consent).
        if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
            errors.push(
                err(
                    "capabilityEnabledNotBoolean",
                    `capability "${name}": enabled must be a boolean`,
                    `capabilities.${name}.enabled`,
                ),
            );
        }
        const settings = value.settings ?? {};
        if (!isPlainObject(settings)) {
            errors.push(
                err(
                    "notAMapping",
                    `capability "${name}": settings must be a mapping`,
                    `capabilities.${name}.settings`,
                ),
            );
            continue;
        }
        const enabled = value.enabled === true;
        if (!admitted.has(name)) {
            errors.push(
                err(
                    "capabilityUnknown",
                    `capability "${name}" is not available in this application` +
                        ` (available: ${[...admitted.keys()].sort().join(", ") || "none"})`,
                    `capabilities.${name}`,
                ),
            );
        }
        /**
         * D84 — a settings key the capability never declared configures
         * nothing. `projectCapabilityView` drops it silently, so `annouce:`
         * used to be a working file that did the opposite of what it said.
         * `unknownKey` rather than a code of its own: the declared keys ARE
         * the schema for this block, and the maintainer's fix is the same
         * one every other unknown key asks for.
         *
         * Disabled blocks are checked too. A typo that waits for the day
         * somebody flips `enabled` is the surprise this rule exists to end.
         */
        const declared = admitted.get(name) ?? null;
        if (declared !== null) {
            for (const key of Object.keys(settings)) {
                if (!declared.configKeys.includes(key)) {
                    errors.push(
                        err(
                            "unknownKey",
                            `capability "${name}": unknown setting "${key}"` +
                                ` (it declares: ${[...declared.configKeys].sort().join(", ") || "no settings"})`,
                            `capabilities.${name}.settings.${key}`,
                        ),
                    );
                }
            }
        }
        entries.push([name, { enabled, settings }]);
    }
    return checked(entries, errors);
}

/**
 * What one mapping family under `mappings` is: its closed set of meanings, what
 * a well-formed spelling looks like, how it judges two spellings to be the same
 * one, and what it calls each way of being wrong.
 *
 * `fold` and `collisionNote` are one decision in two halves. `fold` decides
 * which spellings collide; `collisionNote` is how the maintainer is told that
 * two spellings they wrote differently are the same one. A family that changes
 * either must change the other.
 */
export interface MeaningFamily<M extends string> {
    /** Dotted, like `mappings.labels`. Prefixes every path and message. */
    readonly path: string;
    /** What one entry's value is called, singular: `label`. */
    readonly noun: string;
    readonly meanings: readonly M[];
    readonly fold: (spelling: string) => string;
    /** The parenthetical for a collision between spellings that differ. */
    readonly collisionNote: (otherSpelling: string) => string;
    /** A shape beyond non-empty text, and the sentence demanding it. */
    readonly wellFormed?: { readonly holds: (spelling: string) => boolean; readonly must: string };
    readonly notMappable: ConfigErrorCode;
    readonly invalid: ConfigErrorCode;
    readonly notInjective: ConfigErrorCode;
}

/**
 * One family's entries, read: each meaning the family admits, mapped to the
 * spelling this repository chose for it.
 *
 * Families are fully injective, and uniqueness is judged under the family's own
 * fold rather than by exact string. For labels that fold is the way GitHub
 * judges it — case- and edge-whitespace-insensitively, so `status: ready` and
 * `Status: Ready` are one label and cannot map two meanings
 * (`FINDING(config-label-injectivity)` D34, `FINDING(config-label-case)` D55).
 * The original spelling is preserved for writes; only the uniqueness key folds.
 *
 * The caller owns the section around this: that `mappings` exists, that this
 * family's key is one it knows, and that `rawFamily` is a mapping.
 */
export function readMeaningFamily<M extends string>(
    spec: MeaningFamily<M>,
    rawFamily: Record<string, unknown>,
): Checked<Partial<Record<M, string>>> {
    const family: Partial<Record<M, string>> = {};
    const errors: ConfigError[] = [];
    const owner = new Map<string, { meaning: string; spelling: string }>();

    for (const [meaning, spelling] of Object.entries(rawFamily)) {
        // Widened to `readonly string[]`, which is always safe; asserting the
        // untrusted key to be a meaning is the unsound direction.
        if (!(spec.meanings as readonly string[]).includes(meaning)) {
            errors.push(
                err(
                    spec.notMappable,
                    `${spec.path}: "${meaning}" is not a mappable meaning`,
                    `${spec.path}.${meaning}`,
                ),
            );
            continue;
        }
        if (typeof spelling !== "string" || spelling.trim() === "") {
            errors.push(
                err(
                    spec.invalid,
                    `${spec.path}.${meaning}: ${spec.noun} must be a non-empty string`,
                    `${spec.path}.${meaning}`,
                ),
            );
            continue;
        }
        if (spec.wellFormed !== undefined && !spec.wellFormed.holds(spelling)) {
            errors.push(
                err(
                    spec.invalid,
                    `${spec.path}.${meaning}: ${spec.noun} ${spec.wellFormed.must}`,
                    `${spec.path}.${meaning}`,
                ),
            );
            continue;
        }
        const key = spec.fold(spelling);
        const held = owner.get(key);
        if (held !== undefined) {
            errors.push(
                err(
                    spec.notInjective,
                    `${spec.path}: ${spec.noun} ${JSON.stringify(spelling)} is mapped to both "${held.meaning}" and "${meaning}"` +
                        (held.spelling === spelling ? "" : spec.collisionNote(held.spelling)) +
                        ` — ${spec.noun} mappings must be injective (config-schema.md §3)`,
                    `${spec.path}.${meaning}`,
                ),
            );
            continue;
        }
        owner.set(key, { meaning, spelling });
        family[meaning as M] = spelling;
    }
    return checked(family, errors);
}

/** Meaning → the label this repository spells it with. */
const LABELS: MeaningFamily<MappableMeaning> = {
    path: "mappings.labels",
    noun: "label",
    meanings: MAPPABLE_MEANINGS,
    fold: labelKey,
    collisionNote: (other) =>
        ` (differing only in case or surrounding space from ${JSON.stringify(other)}, which GitHub treats as the same label)`,
    notMappable: "meaningNotMappable",
    invalid: "labelInvalid",
    notInjective: "labelNotInjective",
};

/**
 * Command → the word a contributor types for it.
 *
 * The fold is case- and edge-space-insensitive because a comment is typed by
 * hand: `/Assign` and `/assign ` are the same instruction, so they cannot be
 * two. The leading slash is demanded rather than added — a repository that
 * writes `assign:` means a bare word, and silently prefixing it would map a
 * command nobody can type.
 */
const COMMAND_WORDS: MeaningFamily<Command> = {
    path: "mappings.commands",
    noun: "command",
    meanings: COMMANDS,
    fold: labelKey,
    collisionNote: (other) =>
        ` (differing only in case or surrounding space from ${JSON.stringify(other)}, which a contributor types the same way)`,
    wellFormed: {
        holds: (spelling) => spelling.trim().startsWith("/"),
        must: 'must start with "/"',
    },
    notMappable: "commandNotMappable",
    invalid: "commandInvalid",
    notInjective: "commandNotInjective",
};

/**
 * Skill tier → the label this repository spells it with. A tier IS a GitHub
 * label, so it borrows the labels family's fold and its collision wording
 * rather than restating them — the same fact told twice would be two facts.
 */
const SKILLS: MeaningFamily<Skill> = {
    path: "mappings.skills",
    noun: "label",
    meanings: SKILL_TIERS,
    fold: labelKey,
    collisionNote: LABELS.collisionNote,
    notMappable: "skillNotMappable",
    invalid: "skillInvalid",
    notInjective: "skillNotInjective",
};

/** Each family read on its own: absence is empty, a non-mapping is one error. */
function readFamily<M extends string>(
    spec: MeaningFamily<M>,
    raw: unknown,
): Checked<Partial<Record<M, string>>> {
    const family = raw ?? {};
    if (!isPlainObject(family)) {
        return {
            ok: false,
            errors: [err("notAMapping", `${spec.path} must be a mapping`, spec.path)],
        };
    }
    return readMeaningFamily(spec, family);
}

/**
 * Skill tiers and positions are both GitHub labels, so they share one
 * namespace: a label that is a tier cannot also be a position, or the reverse
 * reading of either family would answer two things at once (D34).
 *
 * Only this direction is checked. Within a family `readMeaningFamily` has
 * already refused a repeat, and the tiers are read second, so the label a
 * maintainer must change is the one this names.
 */
function checkSkillsAgainstLabels(
    labels: Partial<Record<MappableMeaning, string>>,
    skills: Partial<Record<Skill, string>>,
): readonly ConfigError[] {
    const positions = new Map(
        Object.entries(labels).map(([meaning, label]) => [labelKey(label), meaning]),
    );
    const errors: ConfigError[] = [];
    for (const [tier, label] of Object.entries(skills)) {
        const meaning = positions.get(labelKey(label));
        if (meaning === undefined) continue;
        errors.push(
            err(
                "skillNotInjective",
                `mappings.skills.${tier}: label ${JSON.stringify(label)} is already mapped to "${meaning}" under mappings.labels` +
                    ` — one label cannot be both a position and a tier (config-schema.md §3)`,
                `mappings.skills.${tier}`,
            ),
        );
    }
    return errors;
}

// ─── The open-keyed families ─────────────────────────────────────────

/**
 * One open family's own words: where it lives, the codes its two refusals
 * carry, and the shape it refuses by NAME rather than by silence.
 *
 * `MeaningFamily` cannot serve an open family — every one of its refusals is
 * about a meaning the platform names, and here the repository names them too.
 * What survives from it is the shape of the entries and the injectivity rule,
 * restated for a value that is an OBJECT rather than a string.
 */
interface OpenFamily {
    readonly path: string;
    readonly invalid: ConfigErrorCode;
    readonly notInjective: ConfigErrorCode;
    /**
     * Keys that name a form this platform has not built yet, and the sentence
     * that says which phase a maintainer is waiting on. `alerts` has one — the
     * design's native `{ field, value }` form needs a project-field read no
     * endpoint row confirms — and a maintainer who writes it deserves to be
     * told, instead of watching their alert never fire.
     */
    readonly unimplemented?: { readonly keys: readonly string[]; readonly note: string };
}

/** The `alerts` family: alert name → the label that carries it. */
const ALERTS: OpenFamily = {
    path: "mappings.alerts",
    invalid: "alertInvalid",
    notInjective: "alertNotInjective",
    unimplemented: {
        keys: ["field", "value"],
        note: "the native field form ({ field, value }) is not implemented — notifications phase 2 (design/guides/capabilities/notifications.md)",
    },
};

/**
 * The `types` family: type name → the label that carries it.
 *
 * Open for the reason `alerts` is: what KINDS of work a repository sorts its
 * issues into is the repository's vocabulary, not the platform's, and a closed
 * list would be this platform telling maintainers which words they may think
 * in. Nothing here compares two types, so the declaration order is the only
 * order there is.
 */
const TYPES: OpenFamily = {
    path: "mappings.types",
    invalid: "typeInvalid",
    notInjective: "typeNotInjective",
};

/**
 * One open-keyed family, entry by entry.
 *
 * One key is admitted inside an entry, `label`. Everything else is refused —
 * a form the family names as unimplemented by that name, anything else as an
 * unknown key — because an entry the platform silently ignored is a mapping a
 * maintainer believes in and nothing reads.
 */
function readOpenFamily(
    spec: OpenFamily,
    raw: unknown,
): Checked<Record<string, OpenMappingSpelling>> {
    const family = raw ?? {};
    if (!isPlainObject(family)) {
        return {
            ok: false,
            errors: [err("notAMapping", `${spec.path} must be a mapping`, spec.path)],
        };
    }
    const entries: Record<string, OpenMappingSpelling> = {};
    const errors: ConfigError[] = [];
    const owner = new Map<string, string>();

    for (const [name, spelling] of Object.entries(family)) {
        const at = `${spec.path}.${name}`;
        if (!isPlainObject(spelling)) {
            errors.push(err(spec.invalid, `${at}: must be a mapping with a "label"`, at));
            continue;
        }
        const waiting = spec.unimplemented;
        if (waiting !== undefined && waiting.keys.some((key) => spelling[key] !== undefined)) {
            errors.push(err(spec.invalid, `${at}: ${waiting.note}`, at));
            continue;
        }
        const unknown = Object.keys(spelling).filter((key) => key !== "label");
        if (unknown.length > 0) {
            errors.push(err("unknownKey", `${at}: unknown key "${unknown[0]}"`, at));
            continue;
        }
        const label = spelling.label;
        if (typeof label !== "string" || label.trim() === "") {
            errors.push(
                err(spec.invalid, `${at}.label: must be a non-empty string`, `${at}.label`),
            );
            continue;
        }
        const held = owner.get(labelKey(label));
        if (held !== undefined) {
            errors.push(
                err(
                    spec.notInjective,
                    `${spec.path}: label ${JSON.stringify(label)} is mapped to both "${held}" and "${name}"` +
                        ` — a mapping family must be injective (config-schema.md §3)`,
                    at,
                ),
            );
            continue;
        }
        owner.set(labelKey(label), name);
        entries[name] = { label };
    }
    return checked(entries, errors);
}

/**
 * Every label already spoken for, and by which family — what a later family is
 * checked against.
 */
function labelsTaken(
    families: readonly (readonly [string, Readonly<Record<string, string>>])[],
): Map<string, string> {
    const taken = new Map<string, string>();
    for (const [family, mapped] of families) {
        for (const [meaning, label] of Object.entries(mapped)) {
            taken.set(labelKey(label), `"${meaning}" under mappings.${family}`);
        }
    }
    return taken;
}

/**
 * An open family's labels are GitHub labels, so they share the one namespace
 * positions and tiers already share (D34): a label that means `inProgress`
 * cannot also be an alert, or the reverse reading would answer two things at
 * once.
 *
 * The open families are read last and each is checked against everything read
 * before it, so the label a maintainer must change is the one this names.
 */
function checkOpenAgainstEarlier(
    spec: OpenFamily,
    taken: Map<string, string>,
    entries: Record<string, OpenMappingSpelling>,
): readonly ConfigError[] {
    const errors: ConfigError[] = [];
    for (const [name, spelling] of Object.entries(entries)) {
        const held = taken.get(labelKey(spelling.label));
        if (held === undefined) continue;
        errors.push(
            err(
                spec.notInjective,
                `${spec.path}.${name}: label ${JSON.stringify(spelling.label)} is already mapped to ${held}` +
                    ` — one label cannot carry two meanings (config-schema.md §3)`,
                `${spec.path}.${name}`,
            ),
        );
    }
    return errors;
}

/** The open families' entries, flattened to name → label, for the sweep above. */
function labelsOf(entries: Record<string, OpenMappingSpelling>): Record<string, string> {
    return Object.fromEntries(
        Object.entries(entries).map(([name, spelling]) => [name, spelling.label]),
    );
}

/**
 * The `mappings` section, family by family. What lives here is the section
 * shape — absence, the sweep for keys no family claims, each family's own
 * mapping check, and the one rule that spans two families; the entries under a
 * family are `readMeaningFamily`'s.
 */
export function readMappings(raw: Record<string, unknown>): Checked<Mappings> {
    if (raw.mappings === undefined) {
        return { ok: true, value: { labels: {}, commands: {}, skills: {}, alerts: {}, types: {} } };
    }
    if (!isPlainObject(raw.mappings)) {
        return {
            ok: false,
            errors: [err("notAMapping", "mappings must be a mapping", "mappings")],
        };
    }
    const section = raw.mappings;

    const errors: ConfigError[] = Object.keys(section)
        .filter((key) => !(MAPPING_SECTION_KEYS as readonly string[]).includes(key))
        .map((key) => err("unknownKey", `mappings: unknown key "${key}"`, `mappings.${key}`));

    const labels = readFamily(LABELS, section.labels);
    const commands = readFamily(COMMAND_WORDS, section.commands);
    const skills = readFamily(SKILLS, section.skills);
    const alerts = readOpenFamily(ALERTS, section.alerts);
    const types = readOpenFamily(TYPES, section.types);
    if (!labels.ok || !commands.ok || !skills.ok || !alerts.ok || !types.ok) {
        return {
            ok: false,
            errors: [
                ...errors,
                ...(labels.ok ? [] : labels.errors),
                ...(commands.ok ? [] : commands.errors),
                ...(skills.ok ? [] : skills.errors),
                ...(alerts.ok ? [] : alerts.errors),
                ...(types.ok ? [] : types.errors),
            ],
        };
    }

    const earlier: [string, Readonly<Record<string, string>>][] = [
        ["labels", labels.value],
        ["skills", skills.value],
    ];
    const shared = [
        ...checkSkillsAgainstLabels(labels.value, skills.value),
        ...checkOpenAgainstEarlier(ALERTS, labelsTaken(earlier), alerts.value),
        ...checkOpenAgainstEarlier(
            TYPES,
            labelsTaken([...earlier, ["alerts", labelsOf(alerts.value)]]),
            types.value,
        ),
    ];
    return checked(
        {
            labels: labels.value,
            commands: commands.value,
            skills: skills.value,
            alerts: alerts.value,
            types: types.value,
        },
        [...errors, ...shared],
    );
}

export function readPrincipals(raw: Record<string, unknown>): Checked<[string, string][]> {
    const entries: [string, string][] = [];
    const errors: ConfigError[] = [];
    if (raw.principals === undefined) return { ok: true, value: entries };
    if (!isPlainObject(raw.principals)) {
        return {
            ok: false,
            errors: [err("notAMapping", "principals must be a mapping", "principals")],
        };
    }
    for (const [key, value] of Object.entries(raw.principals)) {
        if (typeof value !== "string") {
            errors.push(
                err(
                    "principalNotAString",
                    `principals.${key}: must be a string`,
                    `principals.${key}`,
                ),
            );
            continue;
        }
        entries.push([key, value]);
    }
    return checked(entries, errors);
}

// ─── The one cross-section rule ──────────────────────────────────────

/**
 * D84 — an ENABLED capability may not be missing a mapping it declares it
 * needs, in any of the three families. Before this, such a repository parsed
 * clean and the capability skipped itself at runtime, saying so only in a
 * report nobody reads until they wonder why nothing happened.
 *
 * Disabled capabilities demand nothing: a block kept for later is not a
 * promise to run today, and rejecting one would make `enabled: false` harder
 * to write than deleting it.
 *
 * The only check that reads two sections, which is why it is a `check*`
 * called from `parse.ts` rather than part of either — see that file for when.
 */
export function checkRequiredMappings(
    capabilities: readonly (readonly [string, CapabilityConfig])[],
    mappings: Mappings,
    knownCapabilities: readonly (string | AdmittedCapability)[],
): readonly ConfigError[] {
    const admitted = admissionsOf(knownCapabilities);
    const errors: ConfigError[] = [];

    for (const [name, block] of capabilities) {
        const declared = admitted.get(name) ?? null;
        if (!block.enabled || declared === null) continue;
        for (const family of MAPPING_FAMILIES) {
            for (const meaning of declared.requiredMappings[family] ?? []) {
                if (Object.hasOwn(mappings[family], meaning)) continue;
                errors.push(
                    err(
                        "meaningRequired",
                        `capability "${name}" is enabled but requires the meaning "${meaning}", which this repository has not mapped` +
                            ` — add mappings.${family}.${meaning}, or set capabilities.${name}.enabled to false`,
                        `mappings.${family}.${meaning}`,
                    ),
                );
            }
        }
    }
    return errors;
}
