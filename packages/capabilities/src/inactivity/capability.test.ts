/**
 * The two ladders, one row per scenario in `design.md`'s Verified-by table.
 *
 * ONE INTENT PER STALE THING, and it is the ACT. Since grace.md the reminder
 * is not an intent: the act carries the reminder's words, and the platform
 * posts them, records the promise and holds the act for the gap between the
 * two rungs. So a row about a reminder asserts the act's `grace.warning.body`
 * — the same strings, pinned on the intent instead of on a separate comment.
 *
 * The last block is `decide()` with a stubbed `warningFor`, which is where the
 * rest of the ladder actually happens: warned first, acted only after. What
 * neither block reaches is redelivery and the apply-time re-gate, and those
 * rows are left unproved rather than faked.
 *
 * Every fixture is one record — one item, every group read (contracts/facts.md
 * §4). A scenario about two items is two calls, and there is no list to build.
 */

import { describe, expect, it } from "vitest";
import {
    createDestructiveWarning,
    decide as engineDecide,
    projectCapabilityView,
    toEngine,
    writeRequestFor,
    type AnyIntent,
    type AssigneeClock,
    type DestructiveWarning,
    type Externals,
    type MappableMeaning,
    type PlatformHandle,
    type Projection,
} from "@hiero-hackers/automation-core";
import { inactivity, type InactivityDeclaration } from "./capability.js";
import type { InactivityFacts, IssueLadderFacts, PullLadderFacts } from "./declaration.js";
import { configEnabling, sweptIssue, sweptPullRequest } from "../../test/world.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const AT = new Date("2026-09-09T00:00:00.000Z");
const REPO = { owner: "hiero-hackers", repo: "sandbox" } as const;
const ISSUE = { kind: "issue", number: 40 } as const;
const PULL = { kind: "pullRequest", number: 41 } as const;

const ago = (days: number): Date => new Date(AT.getTime() - days * DAY_MS);

/** The label spellings the design's own config example states. */
const LABELS = {
    needsReview: "status: needs review",
    needsRevision: "status: changes requested",
    blocked: "status: blocked",
};

/** `design.md`'s config block, verbatim — the ladder every row below reads. */
const DESIGN_SETTINGS = {
    exemptBlocked: true,
    remindAfterDays: 14,
    reapAfterDays: 21,
    issues: { enabled: true },
    pullRequests: {
        enabled: true,
        reapAfterDays: 60,
        reapWhen: {
            draft: { enabled: true },
            changesRequested: { enabled: true },
            needsRevision: { enabled: true, remindAfterDays: 2, reapAfterDays: 5 },
        },
    },
};

const viewWith = (settings: Readonly<Record<string, unknown>>) =>
    projectCapabilityView(
        inactivity.declaration,
        configEnabling(
            ["inactivity"],
            ["inactivity"],
            { inactivity: settings },
            { labels: LABELS },
        ),
    );

const view = viewWith(DESIGN_SETTINGS);

/**
 * `never` by default so one helper serves both projections: a position with no
 * meaning is assignable to an issue's and a pull request's alike, and one that
 * names a meaning infers it.
 */
function position<M extends MappableMeaning = never>(
    over: {
        readonly meaning?: M | null;
        readonly blocked?: boolean;
        readonly closed?: boolean;
    } = {},
): Projection<M> {
    return {
        kind: "position",
        state: {
            meaning: over.meaning ?? null,
            blocked: over.blocked ?? false,
            closedBy: over.closed === true ? "closedByHuman" : null,
        },
        ignored: [],
    };
}

const assignee = (
    login: string,
    assignedDaysAgo: number,
    lastWorkingAt: Date | null = null,
): AssigneeClock => ({ login, assignedAt: ago(assignedDaysAgo), lastWorkingAt });

const issueRecord = (over: Partial<IssueLadderFacts> = {}): IssueLadderFacts =>
    sweptIssue({
        repository: REPO,
        item: ISSUE,
        observedAt: AT,
        position: position(),
        assignees: [assignee("alice", 40)],
        links: { openPullRequests: [] },
        ...over,
    });

/** A stale draft, seventy days idle — the pull-request ladder's starting point. */
const REVIEW = {
    changesRequested: false,
    reapableSince: ago(70),
    lastCommitAt: null,
} as const;

/**
 * The contributor-side facts take their own overrides, because most rows dial
 * only those. `draft` is spelled here with the review facts although it lives
 * in its own group now: it is one of the three things a row varies, and a
 * caller should not have to know which group each of them sits in.
 */
const pullRecord = (
    over: Partial<PullLadderFacts> = {},
    review: Partial<PullLadderFacts["review"] & PullLadderFacts["readiness"]> = {},
): PullLadderFacts => {
    const { draft, ...rest } = { draft: true, ...review };
    return sweptPullRequest({
        repository: REPO,
        item: PULL,
        observedAt: AT,
        position: position(),
        assignees: [assignee("alice", 40)],
        links: { issues: [] },
        ...over,
        review: { ...REVIEW, ...rest },
        readiness: { draft },
    });
};

/** Inactivity speaks through its intents, so any skip explanation is a failure. */
const handle = (
    resolve: PlatformHandle<InactivityDeclaration>["resolve"],
): PlatformHandle<InactivityDeclaration> => ({
    resolve,
    explain: () => {
        throw new Error("inactivity explains through its intents, never a skip");
    },
});

const answering = (
    answer: Awaited<ReturnType<PlatformHandle<InactivityDeclaration>["resolve"]>>,
): PlatformHandle<InactivityDeclaration> => handle(async () => answer);

const human = answering({ ok: true, value: false });

const decide = async (facts: InactivityFacts, on = view, platform = human) =>
    await inactivity.evaluate(facts, on, platform);

describe("the clocks reset on development activity only", () => {
    it("`/working` after the reminder", async () => {
        // A 40-day assignment, then `/working` three days ago: the clock
        // restarts there, so the run of idleness is three days long and the
        // assignment is not on the ladder at all. The platform's own warning
        // for the old cycle is left holding an effect nothing asks about, and
        // that is cycle scoping — no durable state, just a new occasion.
        const record = issueRecord({ assignees: [assignee("alice", 40, ago(3))] });

        expect(await decide(record)).toEqual([]);
    });

    it("A commit to the PR after the reminder", async () => {
        const record = pullRecord(
            {},
            { draft: false, changesRequested: true, lastCommitAt: ago(2) },
        );

        expect(await decide(record)).toEqual([]);

        // The same rule, once the reset is old enough to be back on the
        // ladder: the clock starts at the NEWEST of the commit and every
        // assignee's `/working`, and that same instant is the activity the
        // platform is handed to compare against its own warning.
        const mixed = pullRecord(
            {
                assignees: [assignee("alice", 80, ago(20)), assignee("bob", 80, ago(40))],
                position: position({ meaning: "needsRevision" }),
            },
            { draft: false, changesRequested: false, lastCommitAt: ago(30) },
        );

        expect(await decide(mixed)).toMatchObject([
            {
                operation: "closePullRequest",
                cause: { observedAt: ago(20) },
                grace: { activityAt: ago(20) },
            },
        ]);
    });

    it("Ordinary comments and reviews after the reminder", async () => {
        // There is no field for a comment or a review, so a clock that saw
        // nothing but chatter is a clock that has not moved — and the act is
        // asked for, carrying the warning the platform posts first.
        const record = pullRecord(
            { position: position({ meaning: "needsRevision" }) },
            { draft: false, changesRequested: false },
        );

        expect(await decide(record)).toMatchObject([
            { operation: "closePullRequest", item: PULL, grace: { days: 3 } },
        ]);
    });
});

describe("the pull-request ladder judges the contributor's wait", () => {
    it("PR stale for a year in `needsReview`", async () => {
        const record = pullRecord(
            { position: position({ meaning: "needsReview" }) },
            { draft: false, reapableSince: ago(365) },
        );

        expect(await decide(record)).toEqual([]);
    });

    it("Draft PR marked ready for review, no `needsRevision`", async () => {
        // Out of draft, nothing asked of the contributor: the wait is the
        // maintainers' again and the clock stops, however long it had run.
        expect(await decide(pullRecord({}, { draft: false }))).toEqual([]);
    });

    it("Stale draft PR with `reapWhen.draft` not enabled", async () => {
        const opted = viewWith({
            ...DESIGN_SETTINGS,
            pullRequests: {
                ...DESIGN_SETTINGS.pullRequests,
                reapWhen: { changesRequested: { enabled: true } },
            },
        });

        expect(await decide(pullRecord(), opted)).toEqual([]);
    });

    it("`needsRevision` override of 2/5 days", async () => {
        const quality = pullRecord(
            { position: position({ meaning: "needsRevision" }) },
            { draft: false, reapableSince: ago(3) },
        );
        // One record, one decision, so the ordinary pull request is its own
        // call: three days is nothing against the sixty-day ladder, and only
        // the label reason's own 2/5 override puts one on the ladder.
        const ordinary = pullRecord(
            { item: { kind: "pullRequest", number: 42 } },
            { draft: false, changesRequested: true, reapableSince: ago(3) },
        );

        expect(await decide(ordinary)).toEqual([]);
        expect(await decide(quality)).toEqual([
            {
                capability: "inactivity",
                repository: REPO,
                item: PULL,
                operation: "closePullRequest",
                desired: { reason: "This pull request was closed after 5 days of inactivity." },
                // The one reason the apply-time re-gate can re-check: draft and
                // changes-requested are modes, and `ClaimedFacts` has no word
                // for either.
                claims: { meaningsPresent: ["needsRevision"], meaningsAbsent: [], closed: false },
                // Dated at the clock's start, so the effect keeps one identity
                // for as long as this run of idleness does.
                cause: { cause: "pullRequestWentStale", observedAt: ago(3) },
                explanation: {
                    capability: "inactivity",
                    summary:
                        "Warned about a pull request stale in needsRevision; the close follows the grace.",
                    detail: ["idle 3 days", "closes after 5 days"],
                },
                idempotencyKey: expect.any(String),
                grace: {
                    // 5 − 2: the gap between the two rungs is the whole of what
                    // this capability says about waiting.
                    days: 3,
                    topic: "needsRevision",
                    warning: {
                        body: "⏰ Hi @alice — this pull request has carried the `needsRevision` label without development activity for 2 days. Push a commit or comment `/working` to let us know you are working on it, otherwise the pull request will be closed on **2026-09-12**.",
                    },
                    notice: {
                        body: "This pull request was closed after 5 days of inactivity.",
                    },
                    cancelledBy: "a commit or a /working comment",
                    reversesWith: "re-assign / reopen",
                    activityAt: null,
                },
            },
        ]);
    });

    it("Review flips a PR `needsReview` → `needsRevision`", async () => {
        const flipped = (daysAgo: number) =>
            pullRecord(
                { position: position({ meaning: "needsRevision" }) },
                { draft: false, reapableSince: ago(daysAgo) },
            );

        // The clock starts at the flip, so the reason's own two days must pass.
        expect(await decide(flipped(1))).toEqual([]);
        expect(await decide(flipped(2))).toMatchObject([
            { operation: "closePullRequest", grace: { days: 3 } },
        ]);
        // Flipped back: the wait is the maintainers' and the clock stops.
        expect(
            await decide(
                pullRecord(
                    { position: position({ meaning: "needsReview" }) },
                    { draft: false, reapableSince: ago(365) },
                ),
            ),
        ).toEqual([]);
    });

    it("does not arm native draft mode without an apply-time claim", async () => {
        expect(await decide(pullRecord({ assignees: [] }))).toEqual([]);
    });

    it("Reaper closes a PR", async () => {
        // The linked issues ride on the record, and alice is long past the
        // issue ladder's 21 days on one of them — but an intent names the
        // record's own item, so the close is the only act and it claims no
        // release. Once the pull request is closed the issue has no open
        // linked pull request, and its own ladder warns then releases her.
        const fresh = { kind: "issue", number: 45 } as const;
        const closing = pullRecord(
            {
                position: position({ meaning: "needsRevision" }),
                links: {
                    issues: [
                        { item: ISSUE, assignees: [assignee("alice", 40), assignee("bob", 2)] },
                        { item: fresh, assignees: [assignee("carol", 2)] },
                    ],
                },
            },
            { draft: false },
        );

        const intents = await decide(closing);

        expect(intents).toEqual([
            expect.objectContaining({
                item: PULL,
                operation: "closePullRequest",
                desired: {
                    reason: "This pull request was closed after 5 days of inactivity.",
                },
            }),
        ]);
    });
});

describe("the issue ladder judges each assignment on its own clock", () => {
    it("Released then re-assigned", async () => {
        // The occasion is the clock's start, so a re-assignment is a different
        // effect from the run of idleness that preceded it: the old warning
        // authorizes nothing, because nothing asks under its identity. That is
        // cycle scoping, and it costs no durable state.
        const record = issueRecord({ assignees: [assignee("alice", 15)] });

        expect(await decide(record)).toEqual([
            {
                capability: "inactivity",
                repository: REPO,
                item: ISSUE,
                operation: "releaseAssignment",
                desired: { login: "alice" },
                claims: { meaningsPresent: [], meaningsAbsent: [], closed: false },
                cause: { cause: "assignmentWentStale", observedAt: ago(15) },
                explanation: {
                    capability: "inactivity",
                    summary:
                        "Warned alice about a stale assignment; the release follows the grace.",
                    detail: ["idle 15 days", "releases after 21 days"],
                },
                idempotencyKey: expect.any(String),
                grace: {
                    days: 7,
                    topic: "alice",
                    warning: {
                        body: "⏰ Hi @alice — you are assigned to this issue, but there is no pull request after 14 days. Still working on it? Comment `/working` to let us know development is active, otherwise this assignment will be released on **2026-09-16**.",
                    },
                    notice: {
                        body: "This assignment was released after 21 days of inactivity. The issue is open for anyone to pick up — you are welcome to `/assign` it again when you have capacity.",
                    },
                    cancelledBy: "a commit or a /working comment",
                    reversesWith: "re-assign / reopen",
                    activityAt: null,
                },
            },
        ]);

        // A longer run of the same assignment is a different occasion, so a
        // warning recorded against one authorizes nothing about the other.
        const older = await decide(issueRecord({ assignees: [assignee("alice", 40)] }));
        expect(older[0]?.idempotencyKey).not.toBe((await decide(record))[0]?.idempotencyKey);
    });

    it("Two assignees, one recent", async () => {
        // Each assignment is judged on its own clock: alice is forty days in
        // and goes on the ladder, bob is thirteen and is not asked about at
        // all. One intent, one person, one warning naming only them.
        const record = issueRecord({
            assignees: [assignee("alice", 40), assignee("bob", 13)],
        });

        expect(await decide(record)).toEqual([
            expect.objectContaining({
                operation: "releaseAssignment",
                desired: { login: "alice" },
                cause: { cause: "assignmentWentStale", observedAt: ago(40) },
                explanation: {
                    capability: "inactivity",
                    summary:
                        "Warned alice about a stale assignment; the release follows the grace.",
                    detail: ["idle 40 days", "releases after 21 days"],
                },
                grace: expect.objectContaining({
                    warning: {
                        body: "⏰ Hi @alice — you are assigned to this issue, but there is no pull request after 14 days. Still working on it? Comment `/working` to let us know development is active, otherwise this assignment will be released on **2026-09-16**.",
                    },
                }),
            }),
        ]);
    });

    it("Issue gains an open linked PR", async () => {
        const record = issueRecord({ links: { openPullRequests: [PULL] } });

        expect(await decide(record)).toEqual([]);
    });
});

describe("what pauses or ends a ladder", () => {
    it("Item gains the `blocked` meaning mid-cycle", async () => {
        const paused = issueRecord({ position: position({ blocked: true }) });
        const pausedPull = pullRecord({ position: position({ blocked: true }) });

        expect(await decide(paused)).toEqual([]);
        expect(await decide(pausedPull)).toEqual([]);
    });

    /** Two shapes no ladder can read, and the same silence for both. */
    it("says nothing about an item it cannot judge", async () => {
        const conflicted = issueRecord({
            position: {
                kind: "conflict",
                positions: ["ready", "inProgress"],
                blocked: false,
                closedBy: null,
                ignored: [],
            },
        });
        const closed = issueRecord({ position: position({ closed: true }) });

        expect(await decide(conflicted)).toEqual([]);
        expect(await decide(closed)).toEqual([]);
    });

    it("leaves a ladder the repository never enabled alone", async () => {
        const parked = viewWith({});

        expect(await decide(issueRecord(), parked)).toEqual([]);
        expect(await decide(pullRecord(), parked)).toEqual([]);
    });
});

describe("never from a bot, and never on an answer it did not get", () => {
    /** A second stale issue, so the answer is seen to stop every one of them. */
    const other = issueRecord({ item: { kind: "issue", number: 44 } });

    it("never reclaims from a bot, warned or not", async () => {
        const bot = answering({ ok: true, value: true });

        expect(await decide(issueRecord(), view, bot)).toEqual([]);
        expect(await decide(other, view, bot)).toEqual([]);
    });

    it("does nothing when it cannot tell whether the assignee is a bot", async () => {
        const undetermined = answering({
            ok: false,
            reason: "unavailable",
            detail: "the actor lookup is not wired up",
        });

        expect(await decide(issueRecord(), view, undetermined)).toEqual([]);
        expect(await decide(other, view, undetermined)).toEqual([]);
    });
});

describe("nothing rides along with a close", () => {
    const other = { kind: "issue", number: 44 } as const;
    const closing = () =>
        pullRecord(
            {
                position: position({ meaning: "needsRevision" }),
                links: {
                    issues: [
                        { item: ISSUE, assignees: [assignee("alice", 40)] },
                        { item: other, assignees: [assignee("alice", 40)] },
                    ],
                },
            },
            { draft: false },
        );

    it("closes and says only that, however many stale linked assignments there are", async () => {
        // Two linked issues, one assignee long overdue on each, and the issue
        // ladder on: still one intent. The linked issues are somebody else's
        // record, so this ladder has no world to judge their assignments in.
        expect(await decide(closing())).toEqual([
            expect.objectContaining({
                item: PULL,
                operation: "closePullRequest",
                desired: {
                    reason: "This pull request was closed after 5 days of inactivity.",
                },
            }),
        ]);
    });

    it("says the same with the issue ladder switched off", async () => {
        const alone = await decide(
            closing(),
            viewWith({ ...DESIGN_SETTINGS, issues: { enabled: false } }),
        );

        expect(alone).toEqual([
            expect.objectContaining({
                operation: "closePullRequest",
                desired: {
                    reason: "This pull request was closed after 5 days of inactivity.",
                },
            }),
        ]);
    });
});

/**
 * The other half of the ladder, where it actually happens: `decide()` with the
 * recorded warning stubbed, so one intent can be watched through warn, wait
 * and act (grace.md §2).
 *
 * The capability says the same thing on every one of these sweeps. What
 * changes is the platform's own record, which is the point: the capability
 * keeps no clock between the rungs and reads no reminder back.
 */
describe("the platform warns, waits, then acts", () => {
    const ENGINE = [toEngine(inactivity)];
    const CONFIG = configEnabling(
        ["inactivity"],
        ["inactivity"],
        { inactivity: DESIGN_SETTINGS },
        { labels: LABELS },
    );

    /** Alice, forty days idle on a 14/21 ladder: seven days of grace. */
    const STALE = issueRecord();

    /** The two facts these rows dial; everything else is the quiet default. */
    interface Dialled {
        readonly killSwitchActive?: boolean;
        readonly latestHumanChangeAt?: Date | null;
        readonly warningFor?: NonNullable<Externals["warningFor"]>;
    }

    const externals = (over: Dialled): Externals => ({
        killSwitchActive: over.killSwitchActive ?? false,
        installationGrants: ["issues:write"],
        latestHumanChangeAt: () => over.latestHumanChangeAt ?? null,
        resolve: (async () => ({ ok: true, value: false })) as NonNullable<Externals["resolve"]>,
        // Spread rather than set: absent IS the "nobody was warned" answer, and
        // an explicit `undefined` is a different thing to say (grace.md §2).
        ...(over.warningFor === undefined ? {} : { warningFor: over.warningFor }),
    });

    const decided = async (over: Dialled = {}) =>
        await engineDecide({ kind: "facts", facts: STALE }, CONFIG, ENGINE, externals(over));

    /** The act as the capability asks for it — what every stub below is about. */
    const actIntent = async (): Promise<AnyIntent> => (await decide(STALE))[0] as AnyIntent;

    /** The warning the platform would have recorded, had it warned at `at`. */
    const warnedAt = (act: AnyIntent, at: Date): DestructiveWarning => {
        const grace = act.grace!;
        return createDestructiveWarning({
            request: writeRequestFor(act),
            warnedAt: at,
            gracePeriodDays: grace.days,
            earliestActionAt: new Date(at.getTime() + grace.days * DAY_MS),
            cancelledBy: grace.cancelledBy,
            reversesWith: grace.reversesWith,
        });
    };

    it("posts the capability's own warning first, and approves no release", async () => {
        const act = await actIntent();
        const decision = await decided();

        expect(
            decision.approved.map((effect) => ({
                operation: effect.intent.operation,
                desired: effect.intent.desired,
                kind: effect.managedComment?.identity.kind,
                topic: effect.managedComment?.identity.topic,
                records: effect.records?.effectId,
            })),
        ).toEqual([
            {
                operation: "postManagedComment",
                desired: { kind: "warning", topic: "alice", body: act.grace?.warning.body },
                kind: "warning",
                // The act's topic: this warning is alice's clock and no one
                // else's, so a second assignee earns a second comment (D145).
                topic: "alice",
                // The warning is its own effect, and it carries the ACT's
                // identity as what it authorizes once it lands.
                records: act.idempotencyKey,
            },
        ]);
        expect(decision.approved[0]?.intent.evaluatedAt).toEqual(AT);
        expect(decision.report.findings.map((finding) => finding.code)).toEqual([
            "capabilityExplained",
            "applied",
        ]);
    });

    it("approves the release once the grace has run and nothing happened", async () => {
        const act = await actIntent();
        const decision = await decided({
            warningFor: () => warnedAt(act, ago(8)),
        });

        expect(
            decision.approved.map((effect) => ({
                operation: effect.intent.operation,
                desired: effect.intent.desired,
                // A graced act gets an identity too — the notice it posts once
                // it lands stands under the act's topic, beside the warning.
                kind: effect.managedComment?.identity.kind,
                topic: effect.managedComment?.identity.topic,
                records: effect.records,
            })),
        ).toEqual([
            {
                operation: "releaseAssignment",
                desired: { login: "alice" },
                kind: "notice",
                topic: "alice",
                records: null,
            },
        ]);
    });

    it("does not mistake the stable assignment clock for the safety cutoff", async () => {
        const act = await actIntent();
        const decision = await decided({
            latestHumanChangeAt: ago(1),
            warningFor: () => warnedAt(act, ago(8)),
        });

        expect(decision.approved).toHaveLength(1);
        expect(decision.approved[0]?.intent.operation).toBe("releaseAssignment");
        expect(decision.approved[0]?.intent.evaluatedAt).toEqual(AT);
    });

    it("says the grace is running, and says it as news rather than a fault", async () => {
        const act = await actIntent();
        const decision = await decided({ warningFor: () => warnedAt(act, ago(2)) });

        expect(decision.approved).toEqual([]);
        expect(decision.report.findings).toEqual([
            expect.objectContaining({ code: "graceRunning", severity: "info" }),
        ]);
    });

    it("Kill switch mid-grace", async () => {
        const act = await actIntent();
        const decision = await decided({
            killSwitchActive: true,
            warningFor: () => warnedAt(act, ago(8)),
        });

        expect(decision.approved).toEqual([]);
        expect(decision.report.findings.map((finding) => finding.code)).toEqual(["killSwitch"]);
    });
});
