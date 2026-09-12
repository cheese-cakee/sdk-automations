/**
 * The one claim the probe world makes that nothing else would catch:
 * `smallestValidSettings` writes a block every spec accepts.
 *
 * `configEnabling` builds every fixture in this package on it, so a spec arm
 * it answered wrongly would surface as "probe config invalid" in a suite about
 * something else entirely — which is the failure the helper exists to end. The
 * spec below states every arm whose `absent` is `problem`, each once at the
 * top level and once inside the one group an absent key still reads through.
 */

import { describe, expect, it } from "vitest";
import {
    block,
    blocks,
    closed,
    count,
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
} from "@hiero-hackers/automation-core";
import { smallestValidSettings } from "./world.js";

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
