/**
 * `readMeaningFamily` — the machinery under `mappings.labels`, tested through
 * a family that is NOT labels.
 *
 * The labels instantiation is already proved byte-for-byte by the rejection
 * corpus (`documents.ts`), which is exactly why it cannot prove this: a test
 * written against labels cannot tell a parameter from a constant. A synthetic
 * family with its own meanings, its own fold, and its own codes can, and is
 * the evidence a second family can be instantiated without reading the body.
 */

import { describe, expect, it } from "vitest";
import { readMeaningFamily, type MeaningFamily } from "../../src/config/sections.js";

type Signal = "hello" | "goodbye" | "thanks";

/**
 * Deliberately the OPPOSITE fold to `labelKey` on the axis that matters: this
 * one ignores all inner space and keeps case, where labels keep inner space
 * and fold case. A body that reached for `labelKey` passes every labels test
 * and fails these.
 */
const SIGNALS: MeaningFamily<Signal> = {
    path: "mappings.signals",
    noun: "signal",
    meanings: ["hello", "goodbye", "thanks"],
    fold: (spelling) => spelling.replace(/\s+/g, ""),
    collisionNote: (other) => ` (spaced differently from ${JSON.stringify(other)})`,
    // Arbitrary but distinct, and none of them the labels family's: the claim
    // is that the spec chooses the code, not that these three mean anything.
    notMappable: "unknownKey",
    invalid: "principalNotAString",
    notInjective: "modeInvalid",
};

const read = (raw: Record<string, unknown>) => readMeaningFamily(SIGNALS, raw);

describe("readMeaningFamily", () => {
    it("maps each meaning to the spelling exactly as written", () => {
        const result = read({ hello: "  Hi   There  ", goodbye: "Bye" });
        expect(result).toEqual({ ok: true, value: { hello: "  Hi   There  ", goodbye: "Bye" } });
    });

    it("admits an empty family, and every meaning at once", () => {
        expect(read({})).toEqual({ ok: true, value: {} });
        expect(read({ hello: "a", goodbye: "b", thanks: "c" })).toEqual({
            ok: true,
            value: { hello: "a", goodbye: "b", thanks: "c" },
        });
    });

    it("rejects a meaning outside the family's closed set, with the spec's code and path", () => {
        const result = read({ hello: "Hi", ready: "Status: Ready" });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.errors).toEqual([
            {
                code: "unknownKey",
                message: `mappings.signals: "ready" is not a mappable meaning`,
                path: "mappings.signals.ready",
            },
        ]);
    });

    it("rejects a spelling that is not a non-empty string", () => {
        for (const bad of [42, null, true, [], {}, "", "   "]) {
            const result = read({ hello: bad });
            expect(result.ok).toBe(false);
            if (result.ok) continue;
            expect(result.errors).toEqual([
                {
                    code: "principalNotAString",
                    message: "mappings.signals.hello: signal must be a non-empty string",
                    path: "mappings.signals.hello",
                },
            ]);
        }
    });

    it("lets the fold decide which spellings collide", () => {
        // Same under this fold, different under labelKey's.
        const spaced = read({ hello: "Hi There", goodbye: "HiThere" });
        expect(spaced.ok).toBe(false);
        if (spaced.ok) return;
        expect(spaced.errors[0]?.code).toBe("modeInvalid");
        expect(spaced.errors[0]?.path).toBe("mappings.signals.goodbye");

        // Different under this fold, the SAME under labelKey's.
        expect(read({ hello: "Hi", goodbye: "hi" })).toEqual({
            ok: true,
            value: { hello: "Hi", goodbye: "hi" },
        });
    });

    it("names the first owner, and explains a collision only when the spellings differ", () => {
        const differing = read({ hello: "Hi There", goodbye: "HiThere" });
        expect(differing.ok).toBe(false);
        if (differing.ok) return;
        expect(differing.errors[0]?.message).toBe(
            `mappings.signals: signal "HiThere" is mapped to both "hello" and "goodbye"` +
                ` (spaced differently from "Hi There")` +
                ` — signal mappings must be injective (config-schema.md §3)`,
        );

        const identical = read({ hello: "Hi", goodbye: "Hi" });
        expect(identical.ok).toBe(false);
        if (identical.ok) return;
        expect(identical.errors[0]?.message).toBe(
            `mappings.signals: signal "Hi" is mapped to both "hello" and "goodbye"` +
                ` — signal mappings must be injective (config-schema.md §3)`,
        );
    });

    it("keeps the fold key out of the value it hands back", () => {
        // The fold is a uniqueness key, never a spelling: a write path must
        // get back what the maintainer typed (D34, D55).
        const result = read({ hello: "Hi   There" });
        expect(result).toEqual({ ok: true, value: { hello: "Hi   There" } });
    });

    it("reports every bad entry, not the first", () => {
        const result = read({ hello: "", nope: "x", goodbye: "Bye", thanks: "Bye" });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.errors.map((e) => e.code)).toEqual([
            "principalNotAString",
            "unknownKey",
            "modeInvalid",
        ]);
    });
});

/**
 * The same family, opened: `meanings: null` is a repository naming the meanings
 * as well, and the only question left about a key is its shape. Synthetic for
 * the reason `SIGNALS` is — a test written against `alerts` cannot tell whether
 * the reader consulted the spec or the one open family the platform ships.
 */
const OPEN_SIGNALS: MeaningFamily<string> = { ...SIGNALS, meanings: null };

describe("readMeaningFamily, opened", () => {
    const readOpen = (raw: Record<string, unknown>) => readMeaningFamily(OPEN_SIGNALS, raw);

    it("admits any name shaped like a key the parser takes", () => {
        expect(readOpen({ p0: "Hi", whateverTheyCallIt9: "Bye" })).toEqual({
            ok: true,
            value: { p0: "Hi", whateverTheyCallIt9: "Bye" },
        });
    });

    it("rejects a name that is not one, with the spec's code and path", () => {
        // `__proto__` and a dotted path are the two that matter: one is the
        // hostile key, the other is unaddressable once it becomes an error path.
        for (const bad of ["a.b", "__proto__", "Upper", "with space", ""]) {
            const result = readOpen({ [bad]: "Hi" });
            expect(result.ok, bad).toBe(false);
            if (result.ok) continue;
            expect(result.errors).toEqual([
                {
                    code: "unknownKey",
                    message: `mappings.signals: ${JSON.stringify(bad)} is not a valid name (camelCase)`,
                    path: `mappings.signals.${bad}`,
                },
            ]);
        }
    });

    it("judges its spellings by the same fold as the closed family", () => {
        const result = readOpen({ p0: "Hi There", urgent: "HiThere" });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.errors[0]?.code).toBe("modeInvalid");
        expect(result.errors[0]?.path).toBe("mappings.signals.urgent");
    });
});
