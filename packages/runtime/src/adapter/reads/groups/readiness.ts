/** Whether the pull request is a draft: the one readiness fact a webhook also reads. */

import { readDraft } from "../items.js";
import type { SweepGroup } from "./module.js";

export const readiness = {
    reads: ["draft"],
    read: {
        pullRequest: async ({ listed, context, walk }) => {
            const draft = await readDraft(context, listed.item.number, walk);
            return draft.ok ? { ok: true, value: { draft: draft.value } } : draft;
        },
    },
} satisfies SweepGroup<"readiness">;
