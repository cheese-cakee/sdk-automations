/** GitHub's lock state, off the item's own list row; a row without it leaves only this group unread. */

import { field } from "../../client/untrusted.js";
import { unreadable } from "../items.js";
import type { SweepGroup } from "./module.js";

export const locked = {
    reads: [],
    read: {
        issue: ({ listed }) => {
            const value = field(listed.entry, "locked");
            return Promise.resolve(
                typeof value === "boolean"
                    ? { ok: true, value }
                    : unreadable(`#${String(listed.item.number)}: locked missing`),
            );
        },
    },
} satisfies SweepGroup<"locked">;
