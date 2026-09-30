/**
 * The group registry (D215): each module's row is the producer table, and a
 * webhook fills exactly the groups its row names, from the payload.
 */

import { describe, expect, it } from "vitest";
import { FACT_GROUPS, FACT_KINDS, UNREAD } from "../../src/catalogue.js";
import {
    deliveredGroups,
    GROUPS,
    PRODUCER_KINDS,
    PRODUCERS,
    readersOf,
    WEBHOOK_PRODUCERS,
    type GroupModule,
} from "../../src/capability/index.js";

describe("each group module's row", () => {
    it("names only producers that make a record of that kind", () => {
        const strays = FACT_KINDS.flatMap((kind) =>
            FACT_GROUPS.flatMap((group) =>
                readersOf(kind, group)
                    .filter(
                        (producer) =>
                            !(PRODUCER_KINDS[producer] as readonly string[]).includes(kind),
                    )
                    .map((producer) => `${producer} reads ${group} on ${kind}`),
            ),
        );
        expect(strays).toEqual([]);
    });

    it("has a webhook read wherever a webhook producer reads the group", () => {
        const unread = FACT_KINDS.flatMap((kind) =>
            FACT_GROUPS.filter(
                (group) =>
                    readersOf(kind, group).some((producer) =>
                        (WEBHOOK_PRODUCERS as readonly string[]).includes(producer),
                    ) && !("fromDelivery" in GROUPS[group]),
            ).map((group) => `${group} on ${kind}`),
        );
        expect(unread).toEqual([]);
    });

    it("cannot name a kind whose record does not carry the group", () => {
        const wrong = {
            readBy: {
                // @ts-expect-error — an issue record carries no `review`.
                issue: ["sweep"],
                pullRequest: ["sweep"],
            },
            fixture: { pullRequest: GROUPS.review.fixture.pullRequest },
        } satisfies GroupModule<"review">;
        expect(Object.keys(wrong.readBy)).toContain("issue");
    });

    it("is the producer table, pinned by value", () => {
        expect(PRODUCERS).toEqual({
            issues: { issue: ["locked", "skills"], pullRequest: null },
            issue_comment: { issue: ["locked", "skills"], pullRequest: null },
            pull_request: { issue: null, pullRequest: ["readiness"] },
            sweep: {
                issue: ["locked", "skills", "assignees", "links"],
                pullRequest: ["assignees", "links", "review", "readiness"],
            },
        });
    });
});

describe("a webhook's groups", () => {
    const delivery = { item: { locked: true, draft: false }, skills: ["beginner"] } as const;

    it("reads what its row names and leaves every other group unread", () => {
        expect(deliveredGroups("issues", "issue", delivery)).toEqual({
            ok: true,
            groups: { locked: true, skills: ["beginner"], assignees: UNREAD, links: UNREAD },
        });
        expect(deliveredGroups("pull_request", "pullRequest", delivery)).toEqual({
            ok: true,
            groups: {
                assignees: UNREAD,
                links: UNREAD,
                review: UNREAD,
                readiness: { draft: false },
            },
        });
    });

    it("refuses a payload that lacks a group it reads, with that group's code", () => {
        expect(deliveredGroups("issue_comment", "issue", { item: {}, skills: [] })).toEqual({
            ok: false,
            code: "lockedMissing",
            detail: "issue_comment: locked missing",
        });
        expect(deliveredGroups("pull_request", "pullRequest", { item: {}, skills: [] })).toEqual({
            ok: false,
            code: "draftMissing",
            detail: "pull_request: draft missing",
        });
    });
});
