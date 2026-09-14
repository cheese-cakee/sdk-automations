/**
 * The claims the fixture harness makes that nothing else would catch:
 * `smallestValidSettings` writes a block every spec accepts, `configEnabling`
 * admits only declarations it was handed, and `factsFor` refuses a record its
 * declaration could not have been given. The spec below states every arm whose
 * `absent` is `problem`, each once at the top level and once inside the one
 * group an absent key still reads through.
 */

import { describe, expect, it } from "vitest";
import {
    block,
    blocks,
    closed,
    count,
    declareCapability,
    duration,
    flag,
    meanings,
    oneOf,
    principal,
    readSettings,
    section,
    sections,
    spec,
    text,
    texts,
    type SettingsView,
} from "../../src/index.js";
import {
    commentedIssue,
    configEnabling,
    factsFor,
    fullestValidSettings,
    smallestValidSettings,
    subsets,
    sweptIssue,
    sweptPullRequest,
    webhookIssue,
    webhookPullRequest,
} from "../../src/author/testing.js";

const NAMES: SettingsView = {
    mapped: { labels: ["blocked"], commands: [], skills: [], alerts: [] },
    principals: ["reviewersTeam", "maintainerTeam"],
};

/** Every required arm, each beside the optional form of the same kind. */
const REQUIRED = spec({
    clock: duration(),
    clockWithDefault: duration({ default: "7d" }),
    guide: text({ optional: false }),
    note: text({ optional: true }),
    notify: principal({ optional: false }),
    cc: principal({ optional: true }),
    noticeOn: oneOf(["latestActivity", "trackingIssue"]),
    announce: flag({ default: false }),
    cap: count({ default: 0 }),
    exemptWhen: meanings(),
    uncounted: texts(),
    // A section has no consent, so its fields are read whether or not it is
    // written — the one group a required key can hide inside.
    onOpen: section({ label: text({ optional: false }), after: duration() }),
    // The three that answer for themselves when absent: parked, empty, null.
    escalate: block({ to: principal({ optional: false }) }),
    reapWhen: blocks({ after: duration() }),
    subscriptions: sections({ to: principal({ optional: false }) }),
    pillars: closed({ atLeast: count({ default: 1 }) }),
});

describe("the smallest block a spec accepts", () => {
    it("writes every required key, at the smallest value its kind admits", () => {
        expect(smallestValidSettings(REQUIRED, NAMES)).toEqual({
            clock: "1h",
            guide: "x",
            notify: "reviewersTeam",
            noticeOn: "latestActivity",
            onOpen: { label: "x", after: "1h" },
        });
    });

    it("is read back clean by the spec it was built from", () => {
        const read = readSettings(REQUIRED, NAMES, smallestValidSettings(REQUIRED, NAMES));
        expect(read.ok ? [] : read.problems.map((p) => p.path)).toEqual([]);
    });

    /**
     * The negative control, and the defect this helper answers: the empty
     * block a fixture used to write is refused at every required arm, group
     * included. A helper that silently wrote nothing would pass the test above
     * and leave this list exactly as long.
     */
    it("proves the empty block is refused at every arm it fills", () => {
        const read = readSettings(REQUIRED, NAMES, {});
        expect(read.ok ? [] : read.problems.map((p) => p.path)).toEqual([
            "clock",
            "guide",
            "notify",
            "noticeOn",
            "onOpen.label",
            "onOpen.after",
        ]);
    });

    /**
     * A required principal is only answerable by a name the DOCUMENT declares,
     * so the helper's answer is the first one offered — and a document
     * offering none is told so by the parser, at the maintainer's own path,
     * rather than by a fixture inventing a name nobody declared.
     */
    it("names a principal the document declares, and cannot invent one it does not", () => {
        const required = spec({ notify: principal({ optional: false }) });
        expect(smallestValidSettings(required, NAMES)).toEqual({ notify: "reviewersTeam" });

        const none: SettingsView = { ...NAMES, principals: [] };
        const read = readSettings(required, none, smallestValidSettings(required, none));
        expect(read.ok ? [] : read.problems.map((p) => p.message)).toEqual([
            "must name a principal",
        ]);
    });
});

/** A capability woken by the sweep, needing the one group only the sweep reads. */
const REAPER = declareCapability({
    name: "reaper",
    triggers: [{ kind: "schedule", description: "nightly" }],
    settings: {},
    requiredMappings: {},
    facts: ["pullRequest"],
    needs: ["review"],
    resolvers: [],
    intents: [],
});

describe("the record a declaration may be handed", () => {
    it("accepts the producer whose row reads every group declared", () => {
        const record = sweptPullRequest();
        expect(factsFor(REAPER, record)).toBe(record);
    });

    /**
     * The refusal that matters: `pull_request` leaves `review` unread, so a
     * fixture wrapping it would hand the capability the one value the engine
     * guarantees it never sees — and the error names who does read it.
     */
    it("refuses a producer that left a declared group unread, naming who reads it", () => {
        expect(() => factsFor(REAPER, webhookPullRequest())).toThrow(
            /"review" is unread on this pullRequest record — read by: sweep/,
        );
    });

    it("refuses a kind the declaration never named", () => {
        expect(() => factsFor(REAPER, webhookIssue())).toThrow(/declares no "issue" record/);
    });
});

describe("the document a fixture enables capabilities in", () => {
    it("enables exactly the names asked for, out of the declarations admitted", () => {
        const config = configEnabling(["reaper"], [REAPER]);
        expect(config.capabilities["reaper"]?.enabled).toBe(true);
    });

    /**
     * The harness cannot look a name up in a registry it is forbidden to
     * import, so an unknown name is a throw here rather than a block the
     * parser silently never saw.
     */
    it("refuses to enable a name no admitted declaration carries", () => {
        expect(() => configEnabling(["notShipped"], [REAPER])).toThrow(
            /no declaration named "notShipped"/,
        );
    });
});

describe("the block that switches a spec on", () => {
    const fullest = fullestValidSettings(REQUIRED, NAMES);

    it("consents to every block, throws every flag, and carries every default", () => {
        expect(fullest).toMatchObject({
            clock: "1h",
            clockWithDefault: "7d",
            announce: true,
            cap: 0,
            escalate: { enabled: true, to: "reviewersTeam" },
            onOpen: { label: "x", after: "1h" },
            pillars: { atLeast: 1 },
        });
    });

    it("is read back clean by the spec it was built from", () => {
        const read = readSettings(REQUIRED, NAMES, fullest);
        expect(read.ok ? [] : read.problems.map((p) => p.path)).toEqual([]);
    });
});

describe("the enumerator a matrix walks", () => {
    it("offers every subset of the names, smallest first", () => {
        expect(subsets(["a", "b"])).toEqual([[], ["a"], ["b"], ["a", "b"]]);
    });
});

describe("the records each producer makes", () => {
    it("reads every group the sweep's row names on an issue", () => {
        expect(sweptIssue()).toMatchObject({
            item: { kind: "issue", number: 13 },
            trigger: { kind: "sweep" },
            actor: null,
            assignees: [],
            links: { openPullRequests: [] },
        });
    });

    it("reads the command on a comment delivery and nothing else", () => {
        expect(commentedIssue()).toMatchObject({
            item: { kind: "issue", number: 15 },
            trigger: { kind: "event", event: "issue_comment" },
            command: null,
            assignees: "unread",
            links: "unread",
        });
    });
});
