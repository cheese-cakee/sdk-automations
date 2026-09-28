/**
 * The reverse lookup is the normalizer's first dependency (the vertical
 * slice), and its contract is mostly about what it REFUSES to find: an
 * unmapped label answers null, never a guess — that is the blast-radius
 * promise docs/configuration.md makes to maintainers, tested here.
 */

import { parseConfig } from "../../src/config/parse.js";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
    MAPPABLE_MEANINGS,
    meaningOfLabel,
    meaningsOfLabels,
    skillsOfLabels,
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

    /** A file that maps nothing carries every meaning at its default spelling (D203). */
    it("an empty mapping finds each default spelling, and nothing else", () => {
        const bare = configWith();
        expect(meaningOfLabel(bare, "status: triage")).toBe("awaitingTriage");
        expect(meaningOfLabel(bare, "Status: Needs Review")).toBe("needsReview");
        expect(meaningOfLabel(bare, "S-review")).toBeNull();
    });

    it("a file spelling one meaning as another's default is refused", () => {
        const result = parseConfig(
            {
                schemaVersion: 2,
                mappings: { labels: { awaitingTriage: "status: ready" } },
            },
            { revision: "rev-shadow", knownCapabilities: [] },
        );
        expect(result.ok ? [] : result.errors.map((e) => `${e.code} @ ${e.path}`)).toEqual([
            "labelNotInjective @ mappings.labels.awaitingTriage",
        ]);
        const both = configWith({ labels: { awaitingTriage: "status: ready", ready: "queue" } });
        expect(meaningOfLabel(both, "status: ready")).toBe("awaitingTriage");
        expect(meaningOfLabel(both, "queue")).toBe("ready");
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

it("reads mapped skill labels in ladder order, however the file lists them", () => {
    const skilled = configWith({
        skills: { advanced: "skill: advanced", beginner: "skill: beginner" },
    });
    expect(skillsOfLabels(skilled, ["SKILL: ADVANCED", "bug", "skill: beginner"])).toEqual([
        "beginner",
        "advanced",
    ]);
});
