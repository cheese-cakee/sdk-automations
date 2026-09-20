/** Everything triageQueue says to a contributor, and the words it says it in. */

import { mentions } from "@hiero-hackers/automation-core/author";

export type SkillChecklist = "missing" | "unaccepted" | "conflict" | "complete";

const skillRows: Readonly<Record<SkillChecklist, string>> = {
    missing: "- [ ] Add one skill label.",
    unaccepted: "- [ ] Use one of the accepted skill labels.",
    conflict: "- [ ] Keep exactly one skill label.",
    complete: "- [x] Skill label added.",
};

/** The welcome a new issue earns; the locked form says why its author cannot reply yet, and what lifts it. */
export function welcome(
    author: string,
    locked: boolean,
    skill: SkillChecklist | null = null,
): string {
    const opening = `👋 Hi ${mentions([author])} — thanks for opening this issue. It is in the triage queue`;
    const message = locked
        ? `${opening}, and the conversation is locked until the team has triaged it. You do not need to do anything: the lock lifts when the issue is marked ready, and we will follow up here.`
        : `${opening}; the team will triage it and follow up here.`;
    return skill === null ? message : `${message}\n\nTriage checklist:\n${skillRows[skill]}`;
}

/** The notice a released issue earns when the repository asked for one. */
export const unlocked = (author: string): string =>
    `✅ Hi ${mentions([author])} — this issue has been triaged and marked ready. The conversation is open again.`;
