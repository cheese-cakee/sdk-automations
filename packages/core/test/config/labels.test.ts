/**
 * The reverse lookup is the normalizer's first dependency (the vertical
 * slice), and its contract is mostly about what it REFUSES to find: an
 * unmapped label answers null, never a guess — that is the blast-radius
 * promise docs/configuration.md makes to maintainers, tested here.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
    alertsOfLabels,
    commandInComment,
    MAPPABLE_MEANINGS,
    meaningOfLabel,
    meaningsOfLabels,
} from "../../src/config/index.js";
import { configWith } from "./builders.js";

const config = configWith({
    labels: {
        awaitingTriage: "status: triage",
        ready: "Status: Ready for Dev",
        blocked: "status: blocked",
    },
});

describe("meaningOfLabel", () => {
    it("finds a mapped label exactly as written", () => {
        expect(meaningOfLabel(config, "status: triage")).toBe("awaitingTriage");
    });

    it("judges sameness the way the validator does — trimmed, case-insensitive (D55)", () => {
        expect(meaningOfLabel(config, "  STATUS: TRIAGE  ")).toBe("awaitingTriage");
        expect(meaningOfLabel(config, "status: ready for dev")).toBe("ready");
    });

    it("answers null for anything unmapped — never a guess", () => {
        expect(meaningOfLabel(config, "status: triag")).toBeNull();
        expect(meaningOfLabel(config, "bug")).toBeNull();
        expect(meaningOfLabel(config, "")).toBeNull();
        expect(meaningOfLabel(config, "   ")).toBeNull();
    });

    it("folds DOWNWARD, pinned on the one character class where it matters", () => {
        // 'ß'.toUpperCase() is 'SS': an upper-folding implementation would
        // match these, a lower-folding one must not. This is also the pin
        // that keeps the shared fold in step with the validator's collision
        // judgment — the two must never diverge.
        const de = configWith({ labels: { ready: "straße" } });
        expect(meaningOfLabel(de, "STRASSE")).toBeNull();
        expect(meaningOfLabel(de, "STRAßE")).toBe("ready");
    });

    it("an empty mapping finds nothing at all", () => {
        const bare = configWith();
        expect(meaningOfLabel(bare, "status: triage")).toBeNull();
    });
});

describe("meaningsOfLabels", () => {
    it("translates a delivery's label list, dropping the unmapped", () => {
        expect(meaningsOfLabels(config, ["bug", "status: triage", "status: blocked"])).toEqual([
            "awaitingTriage",
            "blocked",
        ]);
    });

    it("normalizes independently of input order and duplication", () => {
        const a = meaningsOfLabels(config, ["status: blocked", "status: triage"]);
        const b = meaningsOfLabels(config, ["status: triage", "STATUS: BLOCKED", "status: triage"]);
        expect(a).toEqual(b);
        expect(a).toEqual(["awaitingTriage", "blocked"]);
    });

    it("orders by the platform vocabulary, not the wire", () => {
        // `blocked` is last in MAPPABLE_MEANINGS; wherever it arrives, it sorts last.
        expect(meaningsOfLabels(config, ["status: blocked", "status: ready for dev"])).toEqual([
            "ready",
            "blocked",
        ]);
    });

    it("round-trips every mapped meaning through its own label", () => {
        const everything = configWith({
            labels: Object.fromEntries(MAPPABLE_MEANINGS.map((m) => [m, `lbl ${m}`])),
        });
        const labels = MAPPABLE_MEANINGS.map((m) => `lbl ${m}`);
        expect(meaningsOfLabels(everything, labels)).toEqual([...MAPPABLE_MEANINGS]);
    });

    it("never invents a meaning from arbitrary wire labels", () => {
        fc.assert(
            fc.property(fc.array(fc.string(), { maxLength: 12 }), (labels) => {
                const found = meaningsOfLabels(config, labels);
                for (const meaning of found) {
                    // Everything found must trace to a genuinely matching label.
                    const mapped = config.mappings.labels[meaning];
                    expect(mapped).toBeDefined();
                    expect(
                        labels.some((l) => l.trim().toLowerCase() === mapped!.trim().toLowerCase()),
                    ).toBe(true);
                }
            }),
            { numRuns: 300 },
        );
    });
});

/**
 * The open family's reverse reading. The walk is over the CONFIGURED entries
 * rather than a platform list, because the alert names are the repository's —
 * which is the whole difference between an open family and a closed one.
 */
describe("alertsOfLabels", () => {
    const alerting = configWith({
        labels: { blocked: "status: blocked" },
        alerts: { p0: { label: "P0-🔥" }, security: { label: "Security" } },
    });

    it("names the alerts the labels carry, in the file's own declaration order", () => {
        expect(alertsOfLabels(alerting, ["Security", "P0-🔥"])).toEqual(["p0", "security"]);
    });

    it("judges sameness as every other family does — trimmed, case-insensitive", () => {
        expect(alertsOfLabels(alerting, ["  security  "])).toEqual(["security"]);
    });

    it("is blind to a label this repository mapped to no alert", () => {
        expect(alertsOfLabels(alerting, ["status: blocked", "whatever"])).toEqual([]);
        expect(alertsOfLabels(configWith({}), ["P0-🔥"])).toEqual([]);
    });
});

/**
 * A command is a whole LINE, not a substring: quoting someone else's `/assign`
 * must not execute it, and a repository whose word is `/take` must not be
 * defeated by "/take please".
 */
describe("commandInComment", () => {
    const commanding = configWith({ commands: { assign: "/take", working: "/working" } });

    it("reads the repository's word as the platform's meaning, never the reverse", () => {
        expect(commandInComment(commanding, "/take")).toBe("assign");
        expect(commandInComment(commanding, "/assign")).toBeNull();
    });

    it("takes the first token of any line, ignoring case and trailing words", () => {
        expect(commandInComment(commanding, "hello\n  /TAKE please  \nthanks")).toBe("assign");
    });

    it("refuses a command that is not a line's first token", () => {
        expect(commandInComment(commanding, "> /take")).toBeNull();
        expect(commandInComment(commanding, "you could try /take here")).toBeNull();
    });

    it("skips blank lines rather than reading one as a word", () => {
        expect(commandInComment(commanding, "\n\n   \n/working")).toBe("working");
    });

    it("finds nothing at all in a repository that mapped no command", () => {
        expect(commandInComment(configWith({}), "/take")).toBeNull();
    });
});
