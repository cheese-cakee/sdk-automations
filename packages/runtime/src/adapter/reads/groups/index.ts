/** Every fact group's sweep read, one module each; the read table is read off it (D216). */

import type { FactGroup } from "@hiero-hackers/automation-core";
import type { SweepRead } from "../items.js";
import { assignees } from "./assignees.js";
import { links } from "./links.js";
import { locked } from "./locked.js";
import type { SweepGroup } from "./module.js";
import { readiness } from "./readiness.js";
import { review } from "./review.js";
import { skills } from "./skills.js";

export type { GroupScope, SweepGroup } from "./module.js";

/** The only place the groups are listed here; one with no module fails to compile. */
export const SWEEP_GROUPS: { readonly [G in FactGroup]: SweepGroup<G> } = {
    locked,
    skills,
    assignees,
    links,
    review,
    readiness,
};

/** The reads each group is built from; a group is read only when every one is confirmed. */
export const GROUP_READS = Object.fromEntries(
    Object.entries(SWEEP_GROUPS).map(([group, module]) => [group, module.reads]),
) as { readonly [G in FactGroup]: readonly SweepRead[] };
