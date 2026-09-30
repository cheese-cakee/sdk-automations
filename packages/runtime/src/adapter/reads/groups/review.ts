/** Changes requested, when each reapable mode began, and the last commit. */

import { readReview } from "../items.js";
import type { SweepGroup } from "./module.js";

export const review = {
    reads: ["changesRequested", "reapableSince", "lastCommitAt"],
    read: {
        pullRequest: ({ listed, context, walk }) => readReview(context, listed.item.number, walk),
    },
} satisfies SweepGroup<"review">;
