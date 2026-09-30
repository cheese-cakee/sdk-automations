/**
 * An issue's open pull requests, and a pull request's linked issues with their clocks. An
 * issue's are rebuilt every firing as the inverse of the pull requests', so only those are kept.
 */

import { each, linkedOf, recordOf } from "./decode.js";
import type { GroupModule } from "./module.js";

export const links = {
    readBy: { issue: ["sweep"], pullRequest: ["sweep"] },
    kept: {
        pullRequest: (value) => {
            const issues = each(recordOf(value)?.["issues"], linkedOf);
            return issues === null ? null : { issues };
        },
    },
    fixture: { issue: { openPullRequests: [] }, pullRequest: { issues: [] } },
} satisfies GroupModule<"links">;
