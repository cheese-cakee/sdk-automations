/**
 * The issue ladder: an assigned issue with no open pull request is put on the
 * release ladder, one assignee at a time.
 *
 * ONE intent per stale assignee, and it is the ACT. The reminder is not an
 * intent any more: the act carries its words as grace, and the platform posts
 * them on first sight, records what it promised, and refuses the release until
 * that promise has run out (grace.md §1). What is left here is the clocks that
 * decide WHETHER an assignment is stale, and the words.
 *
 * The guards run in the order `design.md`'s issue flowchart reads its
 * diamonds. One record is one issue (contracts/facts.md §4), so the only loop
 * is over the assignees the record carries.
 */

import {
    assigneeClock,
    CANCELLED_BY,
    people,
    REVERSES_WITH,
    type IntentFor,
} from "@hiero-hackers/automation-core";
import type { LadderContext } from "./context.js";
import type { InactivityDeclaration, IssueLadderFacts } from "./declaration.js";
import { deadlineOf, graceDaysOf, stillOnTheLadder, type Ladder } from "./ladder.js";
import { issueReleaseNotice, issueReminder } from "./messages.js";

export async function onIssue(
    facts: IssueLadderFacts,
    context: LadderContext,
): Promise<readonly IntentFor<InactivityDeclaration>[]> {
    const { issues } = context.settings;
    if (!stillOnTheLadder(facts, context.settings)) return [];
    if (!issues.enabled) return [];
    // With a pull request open, the pull-request ladder governs (design.md).
    if (facts.links.openPullRequests.length > 0) return [];
    return await onLadder(facts, issues, context);
}

/** What one issue past its ladder is worth saying and doing about. */
async function onLadder(
    facts: IssueLadderFacts,
    ladder: Ladder,
    context: LadderContext,
): Promise<readonly IntentFor<InactivityDeclaration>[]> {
    const { observedAt } = context;
    // The date every warning on this sweep names: the observation plus the
    // grace, which is exactly how long the platform will hold each release.
    const deadline = deadlineOf(ladder, observedAt);
    const intents: IntentFor<InactivityDeclaration>[] = [];

    for (const assignee of await people(context.platform, facts.assignees)) {
        const clock = assigneeClock(assignee, observedAt);
        if (clock.idleDays < ladder.remindAfterDays) continue;
        intents.push(
            // Dated at the clock's start, not the sweep: the occasion is the
            // run of idleness, so the effect keeps one identity for as long as
            // the clock runs and a `/working` starts a new one (grace.md §1).
            context.make(
                facts.item,
                clock.idleSince,
            )({
                operation: "releaseAssignment",
                desired: { login: assignee.login },
                cause: "assignmentWentStale",
                claims: { closed: false },
                explain: {
                    summary: `Warned ${assignee.login} about a stale assignment; the release follows the grace.`,
                    detail: [
                        `idle ${String(clock.idleDays)} days`,
                        `releases after ${String(ladder.reapAfterDays)} days`,
                    ],
                },
                grace: {
                    days: graceDaysOf(ladder),
                    // The comment identity's discriminator, and the reason it
                    // exists: two stale assignees are two warnings and two
                    // notices on one issue, not one comment rewritten by
                    // whichever release ran last (D145).
                    topic: assignee.login,
                    // One assignee per intent, so one name per warning: this
                    // release is theirs, and a warning naming somebody whose
                    // own clock is still running would be a lie about them.
                    warning: { body: issueReminder([assignee.login], ladder, deadline) },
                    notice: { body: issueReleaseNotice(ladder.reapAfterDays) },
                    cancelledBy: CANCELLED_BY,
                    reversesWith: REVERSES_WITH,
                    // Their own `/working`, and no one else's: an assignee's
                    // clock is theirs, so the activity that cancels it is too.
                    activityAt: assignee.lastWorkingAt,
                },
            }),
        );
    }
    return intents;
}
