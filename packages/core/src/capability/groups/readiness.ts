/** Whether the author has offered the pull request for review: the one fact a webhook reads whole. */

import { recordOf } from "./decode.js";
import type { GroupModule } from "./module.js";

export const readiness = {
    readBy: { pullRequest: ["pull_request", "sweep"] },
    kept: {
        pullRequest: (value) => {
            const read = recordOf(value);
            return read === null || typeof read["draft"] !== "boolean"
                ? null
                : { draft: read["draft"] };
        },
    },
    fromDelivery: ({ item }) =>
        typeof item["draft"] === "boolean" ? { draft: item["draft"] } : null,
    missing: { code: "draftMissing", detail: "draft missing" },
    fixture: { pullRequest: { draft: true } },
} satisfies GroupModule<"readiness">;
