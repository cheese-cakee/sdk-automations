/**
 * Reading the label mapping in the direction GitHub speaks it: which meaning a
 * label on the wire carries. An unmapped label answers `null`, never a guess.
 */

import {
    MAPPABLE_MEANINGS,
    SKILL_TIERS,
    type MappableMeaning,
    type RepositoryConfig,
    type Skill,
} from "./schema.js";

/** Sameness, in one place for the validator's collisions and this lookup (D55). */
export function labelKey(label: string): string {
    return label.trim().toLowerCase();
}

/** The meaning a repository label carries, or `null` for an unmapped label. */
export function meaningOfLabel(config: RepositoryConfig, label: string): MappableMeaning | null {
    const wanted = labelKey(label);
    for (const meaning of MAPPABLE_MEANINGS) {
        const mapped = config.mappings.labels[meaning];
        if (mapped !== undefined && labelKey(mapped) === wanted) {
            return meaning;
        }
    }
    return null;
}

/** The members of a closed family whose labels are carried, in the family's own order. */
function carriedOf<M extends string>(
    family: readonly M[],
    mapped: Partial<Readonly<Record<M, string>>>,
    labels: readonly string[],
): readonly M[] {
    const carried = new Set(labels.map(labelKey));
    return family.filter((member) => {
        const label = mapped[member];
        return label !== undefined && carried.has(labelKey(label));
    });
}

/** Every mapped meaning in a set of labels, in `MAPPABLE_MEANINGS` order. */
export function meaningsOfLabels(
    config: RepositoryConfig,
    labels: readonly string[],
): readonly MappableMeaning[] {
    return carriedOf(MAPPABLE_MEANINGS, config.mappings.labels, labels);
}

/** Every mapped skill tier in a set of labels, easiest first (D127). */
export function skillsOfLabels(
    config: RepositoryConfig,
    labels: readonly string[],
): readonly Skill[] {
    return carriedOf(SKILL_TIERS, config.mappings.skills, labels);
}
