import { describe, expect, it } from "vitest";
import { lines, normalizeNewlines, normalizeRepoPath } from "./repository.js";

describe("portable repository parsing", () => {
    it.each([
        ["core/src/github/failures.ts", "core/src/github/failures.ts"],
        ["core\\src\\github\\failures.ts", "core/src/github/failures.ts"],
    ])("normalizes repository path %s", (input, expected) => {
        expect(normalizeRepoPath(input)).toBe(expected);
    });

    it.each([
        ["one\ntwo\n", "one\ntwo\n"],
        ["one\r\ntwo\r\n", "one\ntwo\n"],
    ])("normalizes line endings in %j", (input, expected) => {
        expect(normalizeNewlines(input)).toBe(expected);
        expect(lines(input)).toEqual(["one", "two", ""]);
    });
});
