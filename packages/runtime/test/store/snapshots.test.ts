/**
 * The column a stored read is written to and read back from: every group of
 * both kinds through the round trip, the sentinel included, bytes nobody can
 * read answering nothing, and whether a read still answers what a repository
 * needs. The rule that decides when one is reused is the driver's, in
 * `sweep.test.ts`.
 */

import { describe, expect, it } from "vitest";
import { UNREAD, type FactGroup } from "@hiero-hackers/automation-core";
import {
    decodeSnapshot,
    encodeSnapshot,
    snapshotAnswers,
    type SnapshotFacts,
} from "../../src/store/snapshots.js";

const ISSUE = { kind: "issue", number: 12 } as const;

const CLOCKS = [
    {
        login: "ada",
        assignedAt: new Date("2026-08-01T00:00:00.000Z"),
        lastWorkingAt: new Date("2026-08-02T00:00:00.000Z"),
    },
    { login: "grace", assignedAt: new Date("2026-08-03T00:00:00.000Z"), lastWorkingAt: null },
];

/** Every group a pull request's read fills, each carrying an instant. */
const PULL_REQUEST: SnapshotFacts = {
    kind: "pullRequest",
    groups: ["assignees", "links", "review", "readiness"],
    assignees: CLOCKS,
    links: { issues: [{ item: ISSUE, assignees: CLOCKS }] },
    review: {
        changesRequested: true,
        reapableSince: {
            needsRevision: new Date("2026-08-04T00:00:00.000Z"),
            changesRequested: new Date("2026-08-05T00:00:00.000Z"),
            draft: new Date("2026-08-06T00:00:00.000Z"),
        },
        lastCommitAt: new Date("2026-08-07T00:00:00.000Z"),
    },
    readiness: { draft: false },
    closes: [ISSUE],
};

const ISSUE_READ: SnapshotFacts = { kind: "issue", groups: ["assignees"], assignees: CLOCKS };

const roundTrip = (facts: SnapshotFacts): SnapshotFacts | null =>
    decodeSnapshot(encodeSnapshot(facts));

describe("a read written and read back", () => {
    it("returns every group of a pull request, instants and all", () => {
        expect(roundTrip(PULL_REQUEST)).toEqual(PULL_REQUEST);
    });

    it("returns an issue's own group, and its empty clocks", () => {
        expect(roundTrip(ISSUE_READ)).toEqual(ISSUE_READ);
        expect(roundTrip({ ...ISSUE_READ, assignees: [] })).toEqual({
            ...ISSUE_READ,
            assignees: [],
        });
    });

    /** A group nobody read stays a group nobody read: the sentinel is a value here too. */
    it("returns the sentinel for every group that carried it", () => {
        const unread: SnapshotFacts = {
            kind: "pullRequest",
            groups: [],
            assignees: UNREAD,
            links: UNREAD,
            review: UNREAD,
            readiness: UNREAD,
            closes: UNREAD,
        };

        expect(roundTrip(unread)).toEqual(unread);
        expect(roundTrip({ ...ISSUE_READ, assignees: UNREAD })).toEqual({
            ...ISSUE_READ,
            assignees: UNREAD,
        });
    });

    /** An instant is written as its ISO spelling, which is what makes a column readable by eye. */
    it("keeps which kind a reference names", () => {
        const pull = { kind: "pullRequest", number: 9 } as const;
        const stored = roundTrip({
            ...PULL_REQUEST,
            links: { issues: [{ item: pull, assignees: [] }] },
            closes: [pull, ISSUE],
        });

        expect(stored).toMatchObject({
            links: { issues: [{ item: pull }] },
            closes: [pull, ISSUE],
        });
    });

    it("writes the instants as ISO strings", () => {
        expect(encodeSnapshot(ISSUE_READ)).toContain('"assignedAt":"2026-08-01T00:00:00.000Z"');
    });
});

/** Every mode dated, the shape `reapableSince` is written in. */
const MODES = {
    needsRevision: "2026-08-04T00:00:00.000Z",
    changesRequested: "2026-08-05T00:00:00.000Z",
    draft: "2026-08-06T00:00:00.000Z",
};

describe("bytes no read wrote", () => {
    it.each([
        ["not JSON at all", "{"],
        ["not an object", "[1, 2]"],
        ["a kind nobody reads", '{"kind":"discussion","groups":[]}'],
        ["a group name nobody declares", '{"kind":"issue","groups":["mood"],"assignees":[]}'],
        ["groups that are not a list", '{"kind":"issue","groups":"assignees","assignees":[]}'],
        ["a clock with no login", '{"kind":"issue","groups":[],"assignees":[{"assignedAt":"x"}]}'],
        [
            "an undated clock",
            '{"kind":"issue","groups":[],"assignees":[{"login":"ada","assignedAt":"whenever"}]}',
        ],
        [
            "a reset that is neither an instant nor absent",
            '{"kind":"issue","groups":[],"assignees":[{"login":"ada","assignedAt":"2026-08-01T00:00:00.000Z","lastWorkingAt":"soon"}]}',
        ],
        ["a pull request missing a group", '{"kind":"pullRequest","groups":[],"assignees":[]}'],
        ["nothing at all", "null"],
        ["no groups", '{"kind":"issue","assignees":[]}'],
        ["a clock that is not a record", '{"kind":"issue","groups":[],"assignees":[5]}'],
        [
            "a clock whose login is not text",
            '{"kind":"issue","groups":[],"assignees":[{"login":3,"assignedAt":"2026-08-01T00:00:00.000Z"}]}',
        ],
        [
            "an instant written as a number",
            '{"kind":"issue","groups":[],"assignees":[{"login":"ada","assignedAt":1754006400000}]}',
        ],
    ])("answers nothing for %s", (_shape, stored) => {
        expect(decodeSnapshot(stored)).toBeNull();
    });

    it.each([
        ["a link with no item", { links: { issues: [{ assignees: [] }] } }],
        ["links that are not a list", { links: { issues: {} } }],
        ["a review with no verdict", { review: { reapableSince: {} } }],
        [
            "a review missing a mode",
            {
                review: {
                    changesRequested: false,
                    reapableSince: { needsRevision: "2026-08-04T00:00:00.000Z" },
                    lastCommitAt: null,
                },
            },
        ],
        ["a readiness that is not a flag", { readiness: { draft: "no" } }],
        ["a closing reference with no number", { closes: [{ kind: "issue" }] }],
        ["a closing reference with no kind", { closes: [{ number: 7 }] }],
        [
            "a closing reference of a kind nobody reads",
            { closes: [{ kind: "comment", number: 7 }] },
        ],
        ["a closing reference numbered in text", { closes: [{ kind: "issue", number: "7" }] }],
        ["a closing reference not numbered whole", { closes: [{ kind: "issue", number: 1.5 }] }],
        [
            "a link whose item is not a reference",
            { links: { issues: [{ item: 5, assignees: [] }] } },
        ],
        [
            "a link whose clocks are not clocks",
            { links: { issues: [{ item: { kind: "issue", number: 7 }, assignees: [5] }] } },
        ],
        ["links that are not a record", { links: 5 }],
        ["a review that is not a record", { review: 5 }],
        [
            "a review whose verdict is not a flag",
            { review: { changesRequested: "yes", reapableSince: MODES, lastCommitAt: null } },
        ],
        [
            "a review whose modes are not a record",
            { review: { changesRequested: false, reapableSince: 5, lastCommitAt: null } },
        ],
        ...(["needsRevision", "changesRequested", "draft"] as const).map(
            (mode): [string, Record<string, unknown>] => [
                `a review whose ${mode} mode is undated`,
                {
                    review: {
                        changesRequested: false,
                        reapableSince: { ...MODES, [mode]: "whenever" },
                        lastCommitAt: null,
                    },
                },
            ],
        ),
        [
            "a review whose last commit is neither an instant nor absent",
            { review: { changesRequested: false, reapableSince: MODES, lastCommitAt: "soon" } },
        ],
        ["a pull request whose clocks are not clocks", { assignees: [5] }],
    ])("answers nothing for %s", (_shape, broken) => {
        const stored = JSON.stringify({ ...JSON.parse(encodeSnapshot(PULL_REQUEST)), ...broken });

        expect(decodeSnapshot(stored)).toBeNull();
    });
});

describe("whether a stored read still answers", () => {
    it.each<[string, SnapshotFacts, readonly FactGroup[]]>([
        ["an issue", { ...ISSUE_READ, assignees: UNREAD } as SnapshotFacts, ["assignees"]],
        [
            "a pull request",
            { ...PULL_REQUEST, assignees: UNREAD } as SnapshotFacts,
            PULL_REQUEST.groups,
        ],
    ])("answers nothing for %s whose needed clocks went unread", (_kind, stored, needed) => {
        expect(snapshotAnswers(stored, needed)).toBe(false);
    });

    it("answers for an issue read with no groups, whatever its clocks say", () => {
        const stored: SnapshotFacts = { kind: "issue", groups: [], assignees: UNREAD };

        expect(snapshotAnswers(stored, [])).toBe(true);
    });

    it("answers the set it was read with", () => {
        expect(snapshotAnswers(PULL_REQUEST, ["assignees", "links", "review", "readiness"])).toBe(
            true,
        );
        expect(snapshotAnswers(ISSUE_READ, ["assignees"])).toBe(true);
    });

    /** The enabled set moved, so what the read left out is a gap nobody can see (D195, D193). */
    it("answers nothing for a set that is not the one it was read with", () => {
        expect(snapshotAnswers(ISSUE_READ, ["assignees", "links"])).toBe(false);
        expect(snapshotAnswers(PULL_REQUEST, ["assignees"])).toBe(false);
    });

    /** A read that failed is not an answer to keep for a day; the item is read again. */
    it("answers nothing when a group it was read with went unread", () => {
        expect(snapshotAnswers({ ...ISSUE_READ, assignees: UNREAD }, ["assignees"])).toBe(false);
        expect(
            snapshotAnswers({ ...PULL_REQUEST, review: UNREAD }, [
                "assignees",
                "links",
                "review",
                "readiness",
            ]),
        ).toBe(false);
    });

    it("keeps answering when a group nobody needs went unread", () => {
        expect(snapshotAnswers({ ...ISSUE_READ, groups: [], assignees: UNREAD }, [])).toBe(true);
    });
});
