/** Changes requested, when each reapable mode began, and the last commit: the timeline's. */

import { instantOf, optionalInstant, recordOf } from "./decode.js";
import type { GroupModule } from "./module.js";

const SINCE = new Date("2026-07-01T00:00:00.000Z");

export const review = {
    readBy: { pullRequest: ["sweep"] },
    kept: {
        pullRequest: (value) => {
            const read = recordOf(value);
            const since = recordOf(read?.["reapableSince"]);
            const needsRevision = instantOf(since?.["needsRevision"]);
            const changesRequested = instantOf(since?.["changesRequested"]);
            const draft = instantOf(since?.["draft"]);
            const commit = optionalInstant(read?.["lastCommitAt"]);
            if (read === null || typeof read["changesRequested"] !== "boolean") return null;
            if (needsRevision === null || changesRequested === null || draft === null) return null;
            if (commit === null) return null;
            return {
                changesRequested: read["changesRequested"],
                reapableSince: { needsRevision, changesRequested, draft },
                lastCommitAt: commit.at,
            };
        },
    },
    fixture: {
        pullRequest: {
            changesRequested: false,
            reapableSince: { needsRevision: SINCE, changesRequested: SINCE, draft: SINCE },
            lastCommitAt: null,
        },
    },
} satisfies GroupModule<"review">;
