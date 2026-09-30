/** The mapped skill tiers, off the labels the list already carries. */

import { skillsOfLabels } from "@hiero-hackers/automation-core";
import type { SweepGroup } from "./module.js";

export const skills = {
    reads: [],
    read: {
        issue: ({ listed, context }) =>
            Promise.resolve({ ok: true, value: skillsOfLabels(context.config, listed.labels) }),
    },
} satisfies SweepGroup<"skills">;
