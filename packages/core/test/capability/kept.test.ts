/**
 * A kept group's stored value read back (D193): each module's decoder takes what
 * JSON made of its value, answers the sentinel for the sentinel, and `null` for
 * any shape it did not write.
 */

import { describe, expect, it } from "vitest";
import { UNREAD } from "../../src/catalogue.js";
import { decodeKept, keptOn } from "../../src/capability/index.js";
import { recordOf } from "../../src/capability/groups/decode.js";

const ISSUE = { kind: "issue", number: 12 } as const;

const CLOCKS = [
    {
        login: "ada",
        assignedAt: new Date("2026-08-01T00:00:00.000Z"),
        lastWorkingAt: new Date("2026-08-02T00:00:00.000Z"),
    },
    { login: "grace", assignedAt: new Date("2026-08-03T00:00:00.000Z"), lastWorkingAt: null },
];

const MODES = {
    needsRevision: new Date("2026-08-04T00:00:00.000Z"),
    changesRequested: new Date("2026-08-05T00:00:00.000Z"),
    draft: new Date("2026-08-06T00:00:00.000Z"),
};

const REVIEW = {
    changesRequested: true,
    reapableSince: MODES,
    lastCommitAt: new Date("2026-08-07T00:00:00.000Z"),
};

/** One clock as a stored row holds it; each malformed case below breaks exactly one field. */
const CLOCK = { login: "ada", assignedAt: "2026-08-01T00:00:00.000Z", lastWorkingAt: null };

/** What a stored row holds after `JSON.stringify`: every instant as an ISO string. */
const stored = (value: object): Record<string, unknown> => JSON.parse(JSON.stringify(value));

describe("a stored record", () => {
    it("is a plain object, and nothing else", () => {
        expect(recordOf({ draft: false })).toEqual({ draft: false });
        for (const value of [null, [], "draft", 5]) expect(recordOf(value)).toBeNull();
    });
});

describe("the groups kept between firings", () => {
    it("are an issue's clocks, and a pull request's four groups", () => {
        expect(keptOn("issue")).toEqual(["assignees"]);
        expect(keptOn("pullRequest")).toEqual(["assignees", "links", "review", "readiness"]);
    });
});

describe("a kept value read back", () => {
    it.each([
        ["issue", "assignees", CLOCKS],
        ["pullRequest", "assignees", CLOCKS],
        ["pullRequest", "links", { issues: [{ item: ISSUE, assignees: CLOCKS }] }],
        ["pullRequest", "review", REVIEW],
        ["pullRequest", "review", { ...REVIEW, lastCommitAt: null }],
        ["pullRequest", "readiness", { draft: false }],
    ] as const)("returns the %s's %s as written", (kind, group, value) => {
        expect(decodeKept(kind, group, stored(value))).toEqual(value);
    });

    it("returns the sentinel for a group that went unread", () => {
        expect(decodeKept("pullRequest", "review", UNREAD)).toBe(UNREAD);
    });

    it("answers nothing for a group the kind does not keep", () => {
        expect(decodeKept("issue", "links", { openPullRequests: [] })).toBeNull();
    });

    it("answers nothing for a group no kind keeps", () => {
        expect(decodeKept("issue", "locked", false)).toBeNull();
    });
});

describe("a kept value no read wrote", () => {
    it.each([
        ["clocks that are not a list", "assignees", {}],
        ["a clock that is not a record", "assignees", [5]],
        ["a clock with no login", "assignees", [{ ...CLOCK, login: undefined }]],
        ["an undated clock", "assignees", [{ ...CLOCK, assignedAt: "whenever" }]],
        ["an instant written as a number", "assignees", [{ ...CLOCK, assignedAt: 1 }]],
        [
            "a reset that is neither an instant nor absent",
            "assignees",
            [{ ...CLOCK, lastWorkingAt: "soon" }],
        ],
        ["links that are not a record", "links", 5],
        ["links that are not a list", "links", { issues: {} }],
        ["a link that is null", "links", { issues: [null] }],
        ["a link with no item", "links", { issues: [{ assignees: [] }] }],
        ["a link whose item is not a reference", "links", { issues: [{ item: 5, assignees: [] }] }],
        [
            "a link of a kind nobody reads",
            "links",
            { issues: [{ item: { kind: "x", number: 7 }, assignees: [] }] },
        ],
        [
            "a link numbered in text",
            "links",
            { issues: [{ item: { kind: "issue", number: "7" }, assignees: [] }] },
        ],
        [
            "a link not numbered whole",
            "links",
            { issues: [{ item: { kind: "issue", number: 1.5 }, assignees: [] }] },
        ],
        [
            "a link whose clocks are not clocks",
            "links",
            { issues: [{ item: ISSUE, assignees: [5] }] },
        ],
        ["a review that is not a record", "review", 5],
        [
            "a review whose verdict is not a flag",
            "review",
            { ...stored(REVIEW), changesRequested: 1 },
        ],
        [
            "a review whose modes are not a record",
            "review",
            { ...stored(REVIEW), reapableSince: 5 },
        ],
        ...(["needsRevision", "changesRequested", "draft"] as const).map(
            (mode) =>
                [
                    `a review whose ${mode} mode is undated`,
                    "review",
                    { ...stored(REVIEW), reapableSince: { ...stored(MODES), [mode]: "whenever" } },
                ] as const,
        ),
        [
            "a review whose last commit is neither an instant nor absent",
            "review",
            { ...stored(REVIEW), lastCommitAt: "soon" },
        ],
        ["a readiness that is not a record", "readiness", 5],
        ["a readiness that is null", "readiness", null],
        ["a readiness that is not a flag", "readiness", { draft: "no" }],
    ] as const)("answers nothing for %s", (_shape, group, value) => {
        expect(decodeKept("pullRequest", group, value)).toBeNull();
    });
});
