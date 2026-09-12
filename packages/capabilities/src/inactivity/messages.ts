/**
 * Everything inactivity says, and the words it says it in.
 *
 * The reason vocabulary lives here with the phrase each reason renders as, so
 * that `pull-requests.ts` — which decides WHICH reason governs — can name it
 * without this file having to import the ladder back.
 *
 * The SPELLING of a mention and of a date is core's (`facts.ts`), because every
 * capability writes both the same way. The sentences are inactivity's, because
 * nothing else says them.
 */

import { mentions, on } from "@hiero-hackers/automation-core";
import type { Ladder } from "./ladder.js";

/** The three contributor-side modes, in the order the design reads them. */
export const REAP_REASONS = ["needsRevision", "changesRequested", "draft"] as const;

export type ReapReason = (typeof REAP_REASONS)[number];

/**
 * The state a reminder names, one phrase per reason.
 *
 * The design spells the label reason with the repository's own label text. A
 * capability never sees a label string (contract.md §2), so the meaning's name
 * stands in its place.
 */
const REASON_PHRASE: Readonly<Record<ReapReason, string>> = {
    needsRevision: "carried the `needsRevision` label",
    changesRequested: "had **changes requested**",
    draft: "been in **draft**",
};

export function issueReminder(logins: readonly string[], ladder: Ladder, deadline: Date): string {
    return `⏰ Hi ${mentions(logins)} — you are assigned to this issue, but there is no pull request after ${String(ladder.remindAfterDays)} days. Still working on it? Comment \`/working\` to let us know development is active, otherwise this assignment will be released on ${on(deadline)}.`;
}

export function pullRequestReminder(
    logins: readonly string[],
    reason: ReapReason,
    remindAfterDays: number,
    deadline: Date,
): string {
    // No author on the entry, so an unassigned pull request is addressed to
    // nobody rather than to a name this capability had to invent.
    const opening =
        logins.length === 0
            ? "⏰ This pull request has"
            : `⏰ Hi ${mentions(logins)} — this pull request has`;
    return `${opening} ${REASON_PHRASE[reason]} without development activity for ${String(remindAfterDays)} days. Push a commit or comment \`/working\` to let us know you are working on it, otherwise the pull request will be closed on ${on(deadline)}.`;
}

/**
 * The close names the close and nothing else. It claims no release: an intent
 * names the record's own item, so any assignment on a linked issue is that
 * issue's ladder to release on its next sweep.
 *
 * One sentence, two readers: it is the reason the close carries AND the notice
 * the platform posts once the close lands (grace.md §3). A second wording
 * would be the same fact said twice, and the two would drift.
 */
export function closeReason(reapAfterDays: number): string {
    return `This pull request was closed after ${String(reapAfterDays)} days of inactivity.`;
}

/** What the platform posts once a release lands — the design's release text. */
export function issueReleaseNotice(reapAfterDays: number): string {
    return `This assignment was released after ${String(reapAfterDays)} days of inactivity. The issue is open for anyone to pick up — you are welcome to \`/assign\` it again when you have capacity.`;
}
