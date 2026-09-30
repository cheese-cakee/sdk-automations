/** Each assignee's clock: the timeline dates the assignment, the comments the last `/working`. */

import type { SweepGroup } from "./module.js";

export const assignees = {
    reads: ["assignedAt", "lastWorkingAt"],
    read: {
        issue: ({ listed, clocksFor }) => clocksFor(listed.item, listed.assignees),
        pullRequest: ({ listed, clocksFor }) => clocksFor(listed.item, listed.assignees),
    },
} satisfies SweepGroup<"assignees">;
