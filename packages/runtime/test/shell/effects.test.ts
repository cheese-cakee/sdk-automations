/**
 * What an approved effect becomes, and what survives in the journal row.
 *
 * Two claims, and everything here serves one of them. The plan for a label
 * move is add-then-remove, in that order, and it is one call when there is no
 * position to displace. And a row round-trips: the bytes written are the bytes
 * a resend reads, while bytes nobody wrote answer `null` rather than a
 * half-built call.
 */

import type { RepositoryConfig } from "@hiero-hackers/automation-core";
import { describe, expect, it } from "vitest";
import { renderManagedBody, type Call } from "../../src/shell/effects.js";
import {
    operationOf,
    parseJournaledCall,
    planFor,
    serializeCall,
} from "../../src/shell/apply/operations/index.js";
import {
    commentEffect,
    configFor,
    ITEM,
    labelEffect,
    markerOf,
    releaseEffect,
    MERGE_LABEL,
    READY_LABEL,
    REVIEW_LABEL,
    TRIAGE_LABEL,
} from "./apply/effect-harness.js";

/** The define each move plans first: the mapped name with the platform's colour (D202). */
const DEFINE_READY = {
    verb: "defineLabel",
    label: READY_LABEL,
    color: "0e8a16",
    description: "Triaged and ready to be picked up",
} as const;
const DEFINE_REVIEW = {
    verb: "defineLabel",
    label: REVIEW_LABEL,
    color: "5319e7",
    description: "Waiting for a maintainer's review",
} as const;

const config = configFor();

describe("planning a managed comment", () => {
    it("is one call, whose body opens with the marker the platform minted", () => {
        const effect = commentEffect({ body: "Thanks for opening this." });

        const plan = planFor(effect, config);

        expect(plan).toEqual({
            ok: true,
            calls: [
                {
                    verb: "postComment",
                    kind: "summary",
                    body: `${markerOf(effect)}\n\nThanks for opening this.`,
                },
            ],
        });
    });

    it("carries the purpose the capability asked for, not a default", () => {
        const plan = planFor(commentEffect({ kind: "warning" }), config);

        expect(plan.ok && plan.calls[0]).toMatchObject({ verb: "postComment", kind: "warning" });
    });

    it("refuses an effect with no identity to post under", () => {
        const plan = planFor(commentEffect({ withIdentity: false }), config);

        expect(plan).toEqual({
            ok: false,
            code: "identityMissing",
            detail: "the approved effect carries no managed-comment identity to post under",
        });
    });

    it("renders the marker first and the content as its own block", () => {
        expect(renderManagedBody("<!-- m -->", "body")).toBe("<!-- m -->\n\nbody");
    });
});

describe("planning a label move", () => {
    it("adds the target and then removes the position it displaces, in that order", () => {
        const plan = planFor(
            labelEffect({ meaning: "ready", displacing: "awaitingTriage" }),
            config,
        );

        expect(plan).toEqual({
            ok: true,
            calls: [
                DEFINE_READY,
                { verb: "addLabel", label: READY_LABEL },
                { verb: "removeLabel", label: TRIAGE_LABEL },
            ],
        });
    });

    it("is one call when the item held no position to displace", () => {
        const plan = planFor(labelEffect({ meaning: "ready" }), config);

        expect(plan).toEqual({
            ok: true,
            calls: [DEFINE_READY, { verb: "addLabel", label: READY_LABEL }],
        });
    });

    it("is one call when the claimed position is the one being moved to", () => {
        const plan = planFor(labelEffect({ meaning: "ready", displacing: "ready" }), config);

        expect(plan).toEqual({
            ok: true,
            calls: [DEFINE_READY, { verb: "addLabel", label: READY_LABEL }],
        });
    });

    /**
     * `blocked` is a pause flag rather than a position (D28), and a
     * pull-request meaning on an issue is another flow's (D35). Displacing
     * either would remove a label this move has no business touching.
     */
    it("displaces only an own-flow position, never a pause or another flow's", () => {
        const effect = labelEffect({ meaning: "ready", displacing: "awaitingTriage" });
        const widened = {
            ...effect,
            intent: {
                ...effect.intent,
                claims: {
                    meaningsPresent: ["blocked", "needsReview", "awaitingTriage"],
                    meaningsAbsent: [],
                    closed: null,
                },
            },
        } as typeof effect;

        const plan = planFor(widened, config);

        expect(plan).toEqual({
            ok: true,
            calls: [
                DEFINE_READY,
                { verb: "addLabel", label: READY_LABEL },
                { verb: "removeLabel", label: TRIAGE_LABEL },
            ],
        });
    });

    it("reads a pull request's own flow, not an issue's", () => {
        const pr = { kind: "pullRequest", number: 9 } as const;

        expect(
            planFor(
                labelEffect({ item: pr, meaning: "needsReview", displacing: "readyToMerge" }),
                config,
            ),
        ).toEqual({
            ok: true,
            calls: [
                DEFINE_REVIEW,
                { verb: "addLabel", label: REVIEW_LABEL },
                { verb: "removeLabel", label: MERGE_LABEL },
            ],
        });
    });

    it("never displaces an issue position from a pull request", () => {
        const pr = { kind: "pullRequest", number: 9 } as const;

        expect(
            planFor(
                labelEffect({ item: pr, meaning: "needsReview", displacing: "awaitingTriage" }),
                config,
            ),
        ).toEqual({
            ok: true,
            calls: [DEFINE_REVIEW, { verb: "addLabel", label: REVIEW_LABEL }],
        });
    });

    /** A parsed document always maps every meaning (D203); the refusal guards a hand-built one. */
    const withoutInProgress = (): RepositoryConfig => {
        const labels = { ...config.mappings.labels };
        delete (labels as Record<string, string>)["inProgress"];
        return { ...config, mappings: { ...config.mappings, labels } };
    };

    it("refuses when the repository maps no label to the target meaning", () => {
        const plan = planFor(labelEffect({ meaning: "inProgress" }), withoutInProgress());

        expect(plan).toEqual({
            ok: false,
            code: "labelUnmapped",
            detail: "the repository maps no label to inProgress",
        });
    });

    it("refuses when the repository maps no label to the position being displaced", () => {
        const plan = planFor(
            labelEffect({ meaning: "ready", displacing: "inProgress" }),
            withoutInProgress(),
        );

        expect(plan).toEqual({
            ok: false,
            code: "labelUnmapped",
            detail: "the repository maps no label to the displaced position inProgress",
        });
    });
});

describe("planning the assignee pair", () => {
    const assigneeEffect = (operation: "assign" | "unassign") => {
        const effect = labelEffect();
        return {
            ...effect,
            intent: { ...effect.intent, operation, desired: { login: "sophie" } },
        } as unknown as typeof effect;
    };

    it.each([["assign"], ["unassign"]] as const)(
        "%s is one call, planned like any other so the dispatch stays one shape",
        (operation) => {
            expect(planFor(assigneeEffect(operation), config)).toEqual({
                ok: true,
                calls: [{ verb: operation, login: "sophie" }],
            });
        },
    );
});

describe("planning the clock's two acts", () => {
    /** Both plan mechanically; both are refused at the send, not here. */
    const asOperation = (operation: string, desired: unknown) => {
        const effect = labelEffect();
        return {
            ...effect,
            intent: { ...effect.intent, operation, desired },
        } as unknown as typeof effect;
    };

    it("plans a release as one call", () => {
        expect(planFor(asOperation("releaseAssignment", { login: "sophie" }), config)).toEqual({
            ok: true,
            calls: [{ verb: "releaseAssignment", login: "sophie" }],
        });
    });

    it("carries the close's reason onto the call, because the row is what a resend reads", () => {
        expect(
            planFor(asOperation("closePullRequest", { reason: "stale for 60 days" }), config),
        ).toEqual({
            ok: true,
            calls: [{ verb: "closePullRequest", reason: "stale for 60 days" }],
        });
    });

    /**
     * The two moderation verbs plan the same way and are refused at the send,
     * because `PUT`/`DELETE /issues/{n}/lock` are not rows of the endpoint
     * matrix. Two operations rather than one with a flag: a row should name
     * the direction it went.
     */
    it.each([
        ["lockIssue", "until a maintainer reviews it"],
        ["unlockIssue", "a maintainer approved it"],
    ])("plans a %s as one call carrying its reason", (operation, reason) => {
        expect(planFor(asOperation(operation, { reason }), config)).toEqual({
            ok: true,
            calls: [{ verb: operation, reason }],
        });
    });
});

describe("the operation a call belongs to", () => {
    it.each([
        [{ verb: "postComment", kind: "summary", body: "b" }, "postManagedComment"],
        [{ verb: "addLabel", label: "l" }, "applyMappedLabel"],
        [{ verb: "removeLabel", label: "l" }, "applyMappedLabel"],
        [{ verb: "assign", login: "sophie" }, "assign"],
        [{ verb: "unassign", login: "sophie" }, "unassign"],
        [{ verb: "releaseAssignment", login: "sophie" }, "releaseAssignment"],
        [{ verb: "closePullRequest", reason: "r" }, "closePullRequest"],
        [{ verb: "lockIssue", reason: "r" }, "lockIssue"],
        [{ verb: "unlockIssue", reason: "r" }, "unlockIssue"],
    ] as [Call, string][])("reads %o as %s", (call, operation) => {
        expect(operationOf(call)).toBe(operation);
    });
});

describe("the journal row", () => {
    const rowFor = (call: Call): string =>
        serializeCall({ capability: "intake", item: ITEM, call });

    /** The exact bytes, because a resend reads them and a reader greps them. */
    it("spells a comment call one way", () => {
        expect(rowFor({ verb: "postComment", kind: "summary", body: "hello" })).toBe(
            '{"capability":"intake","item":{"kind":"issue","number":164},' +
                '"verb":"postComment","kind":"summary","body":"hello"}',
        );
    });

    it("spells a label call one way", () => {
        expect(rowFor({ verb: "removeLabel", label: TRIAGE_LABEL })).toBe(
            '{"capability":"intake","item":{"kind":"issue","number":164},' +
                '"verb":"removeLabel","label":"status: triage"}',
        );
    });

    it("spells an add-label call one way", () => {
        expect(rowFor({ verb: "addLabel", label: READY_LABEL })).toBe(
            '{"capability":"intake","item":{"kind":"issue","number":164},' +
                '"verb":"addLabel","label":"status: ready"}',
        );
    });

    it("spells an assign one way", () => {
        expect(rowFor({ verb: "assign", login: "sophie" })).toBe(
            '{"capability":"intake","item":{"kind":"issue","number":164},' +
                '"verb":"assign","login":"sophie"}',
        );
    });

    it.each([
        ["lockIssue", "until a maintainer reviews it"],
        ["unlockIssue", "a maintainer approved it"],
    ])("spells a %s one way", (verb, reason) => {
        expect(rowFor({ verb, reason } as Call)).toBe(
            '{"capability":"intake","item":{"kind":"issue","number":164},' +
                `"verb":"${verb}","reason":"${reason}"}`,
        );
    });

    it("spells an unassign one way", () => {
        expect(rowFor({ verb: "unassign", login: "sophie" })).toBe(
            '{"capability":"intake","item":{"kind":"issue","number":164},' +
                '"verb":"unassign","login":"sophie"}',
        );
    });

    /**
     * The clock's two verbs, spelled beside the request's: `unassign` and
     * `releaseAssignment` name the same person and are different rows, because
     * a resend must not read one as authority for the other (D63, D141).
     */
    it("spells a clock-triggered release one way", () => {
        expect(rowFor({ verb: "releaseAssignment", login: "sophie" })).toBe(
            '{"capability":"intake","item":{"kind":"issue","number":164},' +
                '"verb":"releaseAssignment","login":"sophie"}',
        );
    });

    it("spells a pull-request close one way", () => {
        expect(rowFor({ verb: "closePullRequest", reason: "stale for 60 days" })).toBe(
            '{"capability":"intake","item":{"kind":"issue","number":164},' +
                '"verb":"closePullRequest","reason":"stale for 60 days"}',
        );
    });

    it("spells a define one way, the colour and description after the name", () => {
        expect(rowFor(DEFINE_READY)).toBe(
            '{"capability":"intake","item":{"kind":"issue","number":164},' +
                '"verb":"defineLabel","label":"status: ready","color":"0e8a16",' +
                '"description":"Triaged and ready to be picked up"}',
        );
    });

    it.each([
        [{ verb: "postComment", kind: "notice", body: "b" }],
        [DEFINE_READY],
        [{ verb: "addLabel", label: READY_LABEL }],
        [{ verb: "removeLabel", label: TRIAGE_LABEL }],
        [{ verb: "assign", login: "sophie" }],
        [{ verb: "unassign", login: "sophie" }],
        [{ verb: "releaseAssignment", login: "sophie" }],
        [{ verb: "closePullRequest", reason: "stale for 60 days" }],
        [{ verb: "lockIssue", reason: "until a maintainer reviews it" }],
        [{ verb: "unlockIssue", reason: "a maintainer approved it" }],
    ] as [Call][])("round-trips %o", (call) => {
        expect(parseJournaledCall(rowFor(call))).toEqual({
            capability: "intake",
            item: ITEM,
            call,
        });
    });

    it("round-trips a pull request's number and kind", () => {
        const item = { kind: "pullRequest", number: 7 } as const;
        const row = serializeCall({
            capability: "intake",
            item,
            call: { verb: "addLabel", label: READY_LABEL },
        });

        expect(parseJournaledCall(row)).toEqual({
            capability: "intake",
            item,
            call: { verb: "addLabel", label: READY_LABEL },
        });
    });

    it.each([
        ["bytes that are not JSON", "not json"],
        ["a JSON array", "[]"],
        ["a JSON scalar", '"row"'],
        ["no capability", '{"item":{"kind":"issue","number":1},"verb":"addLabel","label":"l"}'],
        [
            "a define without a colour",
            '{"capability":"intake","item":{"kind":"issue","number":1},"verb":"defineLabel","label":"l","description":"d"}',
        ],
        [
            "a define without a description",
            '{"capability":"intake","item":{"kind":"issue","number":1},"verb":"defineLabel","label":"l","color":"0e8a16"}',
        ],
        [
            "a label verb no handler owns",
            '{"capability":"intake","item":{"kind":"issue","number":1},"verb":"paintLabel","label":"l"}',
        ],
        [
            "an empty capability",
            '{"capability":"","item":{"kind":"issue","number":1},"verb":"addLabel","label":"l"}',
        ],
        ["no item", '{"capability":"intake","verb":"addLabel","label":"l"}'],
        [
            "an entity kind nothing declares",
            '{"capability":"intake","item":{"kind":"discussion","number":1},"verb":"addLabel","label":"l"}',
        ],
        [
            "an item number that is not whole",
            '{"capability":"intake","item":{"kind":"issue","number":1.5},"verb":"addLabel","label":"l"}',
        ],
        [
            "an item number below one",
            '{"capability":"intake","item":{"kind":"issue","number":0},"verb":"addLabel","label":"l"}',
        ],
        [
            "a verb nothing sends",
            '{"capability":"intake","item":{"kind":"issue","number":1},"verb":"closeIssue"}',
        ],
        [
            "a label call with no label",
            '{"capability":"intake","item":{"kind":"issue","number":1},"verb":"addLabel"}',
        ],
        [
            "a comment call with no body",
            '{"capability":"intake","item":{"kind":"issue","number":1},"verb":"postComment","kind":"summary"}',
        ],
        [
            "a comment purpose the catalogue does not hold",
            '{"capability":"intake","item":{"kind":"issue","number":1},"verb":"postComment","kind":"gossip","body":"b"}',
        ],
        [
            "an assign with no login",
            '{"capability":"intake","item":{"kind":"issue","number":1},"verb":"assign","login":""}',
        ],
        [
            "an unassign with no login",
            '{"capability":"intake","item":{"kind":"issue","number":1},"verb":"unassign","login":""}',
        ],
        [
            "a release with no login",
            '{"capability":"intake","item":{"kind":"issue","number":1},"verb":"releaseAssignment"}',
        ],
        [
            "a close with no reason",
            '{"capability":"intake","item":{"kind":"pullRequest","number":1},"verb":"closePullRequest","reason":""}',
        ],
        [
            "a lock with no reason",
            '{"capability":"intake","item":{"kind":"issue","number":1},"verb":"lockIssue"}',
        ],
        [
            "an unlock with no reason",
            '{"capability":"intake","item":{"kind":"issue","number":1},"verb":"unlockIssue"}',
        ],
    ])("reads %s as no call at all", (_label, row) => {
        expect(parseJournaledCall(row)).toBeNull();
    });

    /**
     * A plain property read walks the prototype chain, so a row naming
     * `__proto__` would otherwise answer with values GitHub never sent and
     * this platform never wrote.
     */
    it("reads own properties only", () => {
        const row = JSON.stringify(JSON.parse('{"__proto__":{"capability":"intake"}}'));

        expect(parseJournaledCall(row)).toBeNull();
    });
});

/**
 * A graced act is two calls (grace.md §3): the act, then the notice saying
 * what the App did. Order is the whole guarantee — the plan stops at the first
 * refusal, so a notice can never claim an act that did not land.
 */
describe("planning a graced act", () => {
    it("plans the act and then its notice, under the act's own identity", () => {
        const effect = releaseEffect();

        expect(planFor(effect, config)).toEqual({
            ok: true,
            calls: [
                { verb: "releaseAssignment", login: "alice" },
                {
                    verb: "postComment",
                    kind: "notice",
                    body: `${markerOf(effect)}\n\nThis assignment was released after 21 days of inactivity.`,
                },
            ],
        });
    });

    it("refuses an act with no identity to post its notice under", () => {
        const effect = { ...releaseEffect(), managedComment: null };

        expect(planFor(effect, config)).toEqual({
            ok: false,
            code: "identityMissing",
            detail: "the approved act carries no managed-comment identity to post its outcome notice under",
        });
    });

    /** The row is unchanged: a notice is an ordinary `postComment` row. */
    it("spells the notice call exactly as any other comment row", () => {
        const plan = planFor(releaseEffect(), config);
        const notice = plan.ok ? plan.calls[1]! : null;

        expect(serializeCall({ capability: "intake", item: ITEM, call: notice! })).toContain(
            '"verb":"postComment","kind":"notice"',
        );
        expect(operationOf(notice!)).toBe("postManagedComment");
    });
});
