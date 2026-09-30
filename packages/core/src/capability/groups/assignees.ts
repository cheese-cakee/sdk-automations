/** Each assignee with the clock their assignment started; the payload carries no clocks (D47). */

import { clocksOf } from "./decode.js";
import type { GroupModule } from "./module.js";

export const assignees = {
    readBy: { issue: ["sweep"], pullRequest: ["sweep"] },
    kept: { issue: clocksOf, pullRequest: clocksOf },
    fixture: { issue: [], pullRequest: [] },
} satisfies GroupModule<"assignees">;
