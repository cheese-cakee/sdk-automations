/**
 * Reading the label mapping in the direction GitHub speaks it.
 *
 * The reviewed file maps meaning → label, because that is the direction a
 * maintainer thinks in. A webhook delivery arrives speaking the other way:
 * it carries the repository's label strings, and the normalizer
 * (`engine/events.ts`, the vertical slice) must ask "which meaning, if any,
 * is this label?". This is that question, answered once.
 *
 * The lookup is total and closed: an unmapped label answers `null`, never a
 * guess — an unmapped label is INVISIBLE to the platform (docs/configuration.md
 * calls this the maintainer's blast-radius lever, and it is enforced here).
 *
 * Sameness is judged the way the validator judges collisions (D55): trimmed,
 * case-insensitively — `Status: Ready` on the wire matches a mapped
 * `status: ready`. The validator's injectivity rule is what makes this
 * reverse reading well-defined at all: no two meanings can share a label, so
 * the first match is the only match.
 */

import {
    COMMANDS,
    MAPPABLE_MEANINGS,
    type Command,
    type MappableMeaning,
    type RepositoryConfig,
} from "./schema.js";

/**
 * Sameness, in one place for both consumers: the validator's collision check
 * and this lookup. Two copies could disagree on `ß`-class characters, where
 * upper- and lower-folding genuinely differ, and collision judgment must
 * never diverge from lookup judgment (D55).
 */
export function labelKey(label: string): string {
    return label.trim().toLowerCase();
}

/**
 * The meaning a repository label carries, or `null` for any label the
 * repository has not mapped — including the empty string and labels that
 * differ from a mapped one by more than case and surrounding space.
 *
 * Iterates `MAPPABLE_MEANINGS` rather than the config's own entries so the
 * keys keep their type without assertion — the closed union is the walk.
 */
export function meaningOfLabel(config: RepositoryConfig, label: string): MappableMeaning | null {
    // No empty-string case: the validator rejects empty and whitespace
    // labels, so an empty `wanted` can never match a mapped key.
    const wanted = labelKey(label);
    for (const meaning of MAPPABLE_MEANINGS) {
        const mapped = config.mappings.labels[meaning];
        if (mapped !== undefined && labelKey(mapped) === wanted) {
            return meaning;
        }
    }
    return null;
}

/**
 * Every mapped meaning present in a set of repository labels, in
 * `MAPPABLE_MEANINGS` order — the shape the projection consumes. Unmapped
 * labels vanish; duplicates collapse; input order does not matter, so two
 * deliveries listing the same labels differently normalize identically.
 */
export function meaningsOfLabels(
    config: RepositoryConfig,
    labels: readonly string[],
): readonly MappableMeaning[] {
    const present = new Set<MappableMeaning>();
    for (const label of labels) {
        const meaning = meaningOfLabel(config, label);
        if (meaning !== null) present.add(meaning);
    }
    return MAPPABLE_MEANINGS.filter((m) => present.has(m));
}

/**
 * Every alert a set of repository labels carries, in the repository's own
 * declaration order.
 *
 * The same reverse reading as `meaningsOfLabels`, against an open-keyed
 * family: the alert names are the repository's, so the walk is over the
 * configured entries rather than a platform list. Order is `Object.keys` of
 * the mapping, which the parser built by reading the file top to bottom, so
 * two deliveries listing the same labels differently still normalize
 * identically.
 *
 * An unmapped label is invisible here for the same reason it is invisible to
 * `meaningOfLabel`: the mapping is the maintainer's blast-radius lever.
 */
export function alertsOfLabels(
    config: RepositoryConfig,
    labels: readonly string[],
): readonly string[] {
    const carried = new Set(labels.map(labelKey));
    return Object.entries(config.mappings.alerts)
        .filter(([, spelling]) => carried.has(labelKey(spelling.label)))
        .map(([alert]) => alert);
}

/**
 * The command a comment body invokes, or `null` for a comment that invokes
 * none — the same reverse reading as `meaningOfLabel`, one family over.
 *
 * A command is a whole LINE, not a substring: the mapped word must be the
 * first token of some line of the comment, so quoting someone else's
 * `/assign` in a blockquote or naming it mid-sentence does not execute it.
 * Trailing text on the line is ignored rather than refused — a repository
 * whose word is `/take` should not be defeated by "/take please".
 *
 * Case-insensitive and trimmed, judged by `labelKey` so the two families
 * cannot disagree about sameness (D55). An unmapped command is invisible,
 * exactly as an unmapped label is.
 */
export function commandInComment(config: RepositoryConfig, body: string): Command | null {
    for (const line of body.split("\n")) {
        const first = labelKey(line).split(/\s+/)[0];
        if (first === undefined || first === "") continue;
        for (const command of COMMANDS) {
            const spelling = config.mappings.commands[command];
            if (spelling !== undefined && labelKey(spelling) === first) return command;
        }
    }
    return null;
}
