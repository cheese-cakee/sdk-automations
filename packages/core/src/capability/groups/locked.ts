/** GitHub's discussion lock state: on every issue payload and list row. */

import type { GroupModule } from "./module.js";

export const locked = {
    readBy: { issue: ["issues", "issue_comment", "sweep"] },
    fromDelivery: ({ item }) => (typeof item["locked"] === "boolean" ? item["locked"] : null),
    missing: { code: "lockedMissing", detail: "locked missing" },
    fixture: { issue: false },
} satisfies GroupModule<"locked">;
