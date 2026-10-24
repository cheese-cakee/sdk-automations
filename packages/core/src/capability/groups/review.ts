/** The standing change request, when each reapable mode began, and the last commit: the timeline's. */

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
            const requested = optionalInstant(read?.["changesRequestedAt"]);
            const commit = optionalInstant(read?.["lastCommitAt"]);
            if (needsRevision === null || changesRequested === null || draft === null) return null;
            if (requested === null || commit === null) return null;
            return {
                changesRequestedAt: requested.at,
                reapableSince: { needsRevision, changesRequested, draft },
                lastCommitAt: commit.at,
            };
        },
    },
    fixture: {
        pullRequest: {
            changesRequestedAt: null,
            reapableSince: { needsRevision: SINCE, changesRequested: SINCE, draft: SINCE },
            lastCommitAt: null,
        },
    },
} satisfies GroupModule<"review">;
