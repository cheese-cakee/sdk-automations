/** Everything intake says to a contributor, and the words it says it in. */

import { mentions } from "@hiero-hackers/automation-core/author";

/** The welcome a new issue earns; the locked form says why its author cannot reply yet. */
export function welcome(author: string, locked: boolean): string {
    const opening = `👋 Hi ${mentions([author])} — thanks for opening this issue. It is in the triage queue`;
    return locked
        ? `${opening}, and the conversation is locked until a maintainer reviews it. You do not need to do anything; we will unlock it and follow up here.`
        : `${opening}; a maintainer will review it and follow up here.`;
}

/** The confirmation a released issue earns when the repository asked for one. */
export const approved = (author: string): string =>
    `✅ Hi ${mentions([author])} — a maintainer approved this issue. It is open for discussion.`;
