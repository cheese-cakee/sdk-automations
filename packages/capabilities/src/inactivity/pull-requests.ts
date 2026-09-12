/**
 * The pull-request ladder: a pull request whose ball is the contributor's is
 * put on the close ladder. The close is the one act — an intent may only name
 * the record's own item, and a linked issue's assignees are the issue ladder's
 * to release on its own next sweep.
 *
 * ONE intent, and it is the ACT. The reminder is not an intent any more: the
 * close carries its words as grace, and the platform posts them on first
 * sight, records what it promised, and refuses the close until that promise
 * has run out (grace.md §1).
 *
 * The guards run in the order `design.md`'s pull-request flowchart reads its
 * diamonds — the maintainers' wait first, then the mode, then the clock. One
 * record is one pull request (contracts/facts.md §4), so everything judged
 * here arrives on the record or on the context.
 */

import {
    CANCELLED_BY,
    latestOf,
    meaningsOf,
    people,
    pullRequestClock,
    REVERSES_WITH,
    type IntentFor,
} from "@hiero-hackers/automation-core";
import type { InactivitySettings, LadderContext } from "./context.js";
import type { InactivityDeclaration, PullLadderFacts } from "./declaration.js";
import { deadlineOf, graceDaysOf, stillOnTheLadder, type Ladder } from "./ladder.js";
import { closeReason, pullRequestReminder, REAP_REASONS, type ReapReason } from "./messages.js";

/** The first enabled reason that holds, with the clock it resolved. */
interface Reapable extends Ladder {
    readonly reason: ReapReason;
}

/** The pull-request ladder once its block has consented — `enabled: true`. */
type PullRequestLadder = Extract<InactivitySettings["pullRequests"], { readonly enabled: true }>;

/**
 * Which reason governs this pull request, or `null` for none.
 *
 * `null` covers two different situations on purpose — the pull request is in no
 * reapable mode, or it is in one the repository did not opt into — because the
 * answer to both is the same silence. The third, a ladder switched off, is the
 * guard above this: the enabled block is what the caller hands in.
 */
function reapableFor(facts: PullLadderFacts, pullRequests: PullRequestLadder): Reapable | null {
    const holds: Readonly<Record<ReapReason, boolean>> = {
        needsRevision: meaningsOf(facts).includes("needsRevision"),
        changesRequested: facts.review.changesRequested,
        draft: facts.readiness.draft,
    };
    for (const reason of REAP_REASONS) {
        const opted = pullRequests.reapWhen[reason];
        if (opted.enabled && holds[reason]) {
            return {
                reason,
                remindAfterDays: opted.remindAfterDays,
                reapAfterDays: opted.reapAfterDays,
            };
        }
    }
    return null;
}

export async function onPullRequest(
    facts: PullLadderFacts,
    context: LadderContext,
): Promise<readonly IntentFor<InactivityDeclaration>[]> {
    const { pullRequests } = context.settings;
    if (!stillOnTheLadder(facts, context.settings)) return [];
    if (!pullRequests.enabled) return [];

    /**
     * The design's first diamond. A pull request awaiting review — the
     * `needsReview` meaning, or ready for review with nothing asked of the
     * contributor — is the maintainers' wait, not the contributor's.
     */
    const meanings = meaningsOf(facts);
    if (meanings.includes("needsReview")) return [];
    const { draft } = facts.readiness;
    const { changesRequested } = facts.review;
    if (!draft && !changesRequested && !meanings.includes("needsRevision")) return [];

    // In a reapable mode the repository opted into, or nothing to say.
    const reapable = reapableFor(facts, pullRequests);
    if (reapable === null) return [];
    if (reapable.reason !== "needsRevision") return [];

    return await onLadder(facts, reapable, context);
}

/** What one pull request past its ladder is worth saying and doing about. */
async function onLadder(
    facts: PullLadderFacts,
    reapable: Reapable,
    context: LadderContext,
): Promise<readonly IntentFor<InactivityDeclaration>[]> {
    const { observedAt } = context;
    const clock = pullRequestClock(facts, observedAt);
    if (clock.idleDays < reapable.remindAfterDays) return [];

    /**
     * Only the label reason is claimable. `ClaimedFacts` speaks meanings and
     * closure, and draft and changes-requested are neither — so the apply-time
     * re-gate cannot refuse on those two changing.
     */
    const claims = { closed: false, meaningsPresent: ["needsRevision" as const] };
    const logins = (await people(context.platform, facts.assignees)).map(
        (assignee) => assignee.login,
    );

    // The close alone. Once it lands the linked issue has no open pull request,
    // so its own ladder stops being silent and warns then releases on its own
    // clock — which is the only place an assignment on ANOTHER item can be
    // judged against that item's own facts.
    return [
        // Dated at the clock's start, not the sweep: the occasion is the run of
        // idleness, so the effect keeps one identity for as long as the clock
        // runs and a commit starts a new one (grace.md §1).
        context.make(
            facts.item,
            clock.idleSince,
        )({
            operation: "closePullRequest",
            desired: { reason: closeReason(reapable.reapAfterDays) },
            cause: "pullRequestWentStale",
            claims,
            explain: {
                summary: `Warned about a pull request stale in ${reapable.reason}; the close follows the grace.`,
                detail: [
                    `idle ${String(clock.idleDays)} days`,
                    `closes after ${String(reapable.reapAfterDays)} days`,
                ],
            },
            grace: {
                days: graceDaysOf(reapable),
                // One pull request can be on the ladder for one reason at a
                // time, but the reason is what the warning is ABOUT — so it is
                // the topic, and a pull request re-warned under another reason
                // gets its own comment rather than an edit (D145).
                topic: reapable.reason,
                warning: {
                    body: pullRequestReminder(
                        logins,
                        reapable.reason,
                        reapable.remindAfterDays,
                        deadlineOf(reapable, observedAt),
                    ),
                },
                notice: { body: closeReason(reapable.reapAfterDays) },
                cancelledBy: CANCELLED_BY,
                reversesWith: REVERSES_WITH,
                // The pull request's clock is the pull request's, so the
                // activity that cancels it is anyone's on it — the same set
                // `pullRequestClock` resets from.
                activityAt: latestOf([
                    facts.review.lastCommitAt,
                    ...facts.assignees.map((assignee) => assignee.lastWorkingAt),
                ]),
            },
        }),
    ];
}
