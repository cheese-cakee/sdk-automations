/**
 * The total readers for GitHub's bytes, held directly: bad shape answers
 * null or undefined, never a throw — including the shapes that only a
 * direct test can distinguish (the flows above them mask the difference).
 */

import { describe, expect, it } from "vitest";
import { field, jsonArrayOf, jsonRecordOf } from "../src/untrusted.js";

describe("field", () => {
    it("reads a property from an object", () => {
        expect(field({ a: 1 }, "a")).toBe(1);
    });

    it.each([
        ["null", null],
        ["undefined", undefined],
        ["a number", 7],
        ["a string", "x"],
    ])("answers undefined for %s without throwing", (_label, value) => {
        expect(field(value, "a")).toBeUndefined();
    });
});

describe("jsonRecordOf", () => {
    it("answers the object a JSON object body carries", () => {
        expect(jsonRecordOf('{"a":1}')).toEqual({ a: 1 });
    });

    it.each([
        ["unparsable text", "not json"],
        ["a JSON string", '"x"'],
        ["a JSON number", "7"],
        ["a JSON array", "[1]"],
        ["a JSON null", "null"],
    ])("answers null for %s", (_label, body) => {
        expect(jsonRecordOf(body)).toBeNull();
    });
});

describe("jsonArrayOf", () => {
    it("answers the array a JSON array body carries", () => {
        expect(jsonArrayOf("[1,2]")).toEqual([1, 2]);
    });

    it.each([
        ["unparsable text", "not json"],
        ["a JSON object", '{"a":1}'],
        ["a JSON string", '"x"'],
        ["a JSON null", "null"],
    ])("answers null for %s", (_label, body) => {
        expect(jsonArrayOf(body)).toBeNull();
    });
});
