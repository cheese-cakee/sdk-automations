/** The mapped skill tiers an issue carries, read off the labels the preamble already read. */

import type { GroupModule } from "./module.js";

export const skills = {
    readBy: { issue: ["issues", "issue_comment", "sweep"] },
    fromDelivery: (delivery) => delivery.skills,
    fixture: { issue: [] },
} satisfies GroupModule<"skills">;
