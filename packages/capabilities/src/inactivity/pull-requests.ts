/**
 * The pull-request ladder: a pull request whose ball is the contributor's is
 * put on the reminder ladder. An intent may only name its own item.
 *
 * One intent — the close where the level reaps, carrying the reminder's words
 * as grace, and the reminder itself where it does not.
 */

import {
    CANCELLED_BY,
    lasting,
    latestOf,
    meaningsOf,
    people,
    pullRequestClock,
    REVERSES_WITH,
    type ClaimedFacts,
    type IntentFor,
} from "@hiero-hackers/automation-core";
import type { InactivitySettings, LadderContext, MakeIntent } from "./context.js";
import type { InactivityDeclaration, PullLadderFacts } from "./declaration.js";
import {
    graceHoursOf,
    ladderOf,
    reaps,
    stillOnTheLadder,
    type Ladder,
    type Reaping,
} from "./ladder.js";
import { closeReason, pullRequestReminder, REAP_REASONS, type ReapReason } from "./messages.js";

/** The first enabled reason that holds, with the clocks it resolved. */
interface Reapable extends Ladder {
    readonly reason: ReapReason;
}

/**
 * What an intent about this reason claims it saw: the label reason claims its
 * meaning, the two native reasons their mode.
 */
function claimsFor(reason: ReapReason): Partial<ClaimedFacts> {
    return reason === "needsRevision"
        ? { closed: false, meaningsPresent: ["needsRevision"] }
        : { closed: false, pullRequestMode: reason };
}

/** The pull-request ladder once its block has consented — `enabled: true`. */
type PullRequestLadder = Extract<InactivitySettings["pullRequests"], { readonly enabled: true }>;

/**
 * Which reason governs this pull request, or `null` for none — no reapable
 * mode, or one the repository did not opt into.
 */
function reapableFor(facts: PullLadderFacts, pullRequests: PullRequestLadder): Reapable | null {
    const holds: Readonly<Record<ReapReason, boolean>> = {
        needsRevision: meaningsOf(facts).includes("needsRevision"),
        changesRequested: facts.review.changesRequested,
        draft: facts.readiness.draft,
    };
    for (const reason of REAP_REASONS) {
        const opted = pullRequests.reapWhen[reason];
        if (opted.enabled && holds[reason]) return { reason, ...ladderOf(opted) };
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

    // A pull request awaiting review is the maintainers' wait, not the contributor's.
    const meanings = meaningsOf(facts);
    if (meanings.includes("needsReview")) return [];
    const { draft } = facts.readiness;
    const { changesRequested } = facts.review;
    if (!draft && !changesRequested && !meanings.includes("needsRevision")) return [];

    // In a reapable mode the repository opted into, or nothing to say.
    const reapable = reapableFor(facts, pullRequests);
    if (reapable === null) return [];

    return await onLadder(facts, reapable, context);
}

/** What one pull request past its ladder is worth saying and doing about. */
async function onLadder(
    facts: PullLadderFacts,
    reapable: Reapable,
    context: LadderContext,
): Promise<readonly IntentFor<InactivityDeclaration>[]> {
    const { observedAt } = context;
    const clock = pullRequestClock(facts, reapable.reason, observedAt);
    if (clock.idleHours < reapable.remindAfter) return [];

    const logins = (await people(context.platform, facts.assignees)).map(
        (assignee) => assignee.login,
    );
    // Dated at the clock's start, not the sweep: the occasion is the idle run.
    const make = context.make(facts.item, clock.idleSince);

    return [
        reaps(reapable)
            ? close(facts, logins, clock.idleHours, reapable, observedAt, make)
            : remind(logins, clock.idleHours, reapable, observedAt, make),
    ];
}

/** The close alone, carrying the reminder's words as grace. */
function close(
    facts: PullLadderFacts,
    logins: readonly string[],
    idleHours: number,
    reapable: Reapable & Reaping,
    observedAt: Date,
    make: MakeIntent,
): IntentFor<InactivityDeclaration> {
    return make({
        operation: "closePullRequest",
        desired: { reason: closeReason(reapable.reapAfter) },
        cause: "pullRequestWentStale",
        claims: claimsFor(reapable.reason),
        explain: {
            summary: `Warned about a pull request stale in ${reapable.reason}; the close follows the grace.`,
            detail: [`idle ${lasting(idleHours)}`, `closes after ${lasting(reapable.reapAfter)}`],
        },
        grace: {
            hours: graceHoursOf(reapable),
            // The reason is what the warning is about, so it is the topic (D145).
            topic: reapable.reason,
            warning: { body: pullRequestReminder(logins, reapable.reason, reapable, observedAt) },
            notice: { body: closeReason(reapable.reapAfter) },
            cancelledBy: CANCELLED_BY,
            reversesWith: REVERSES_WITH,
            // The set `pullRequestClock` resets from.
            activityAt: latestOf([
                facts.review.lastCommitAt,
                ...facts.assignees.map((assignee) => assignee.lastWorkingAt),
            ]),
        },
    });
}

/**
 * The reminder alone, for a reason whose `reap` block is absent or parked. It
 * takes the identity the platform's own warning would have taken.
 */
function remind(
    logins: readonly string[],
    idleHours: number,
    reapable: Reapable,
    observedAt: Date,
    make: MakeIntent,
): IntentFor<InactivityDeclaration> {
    return make({
        operation: "postManagedComment",
        desired: {
            kind: "warning",
            topic: reapable.reason,
            body: pullRequestReminder(logins, reapable.reason, reapable, observedAt),
        },
        cause: "pullRequestWentStale",
        claims: claimsFor(reapable.reason),
        explain: {
            summary: `Reminded about a pull request stale in ${reapable.reason}; this reason closes nothing.`,
            detail: [`idle ${lasting(idleHours)}`, "no reap block is enabled, so nothing follows"],
        },
    });
}
