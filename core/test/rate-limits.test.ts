import { describe, expect, it } from "vitest";
import { parseSecondsHeader } from "../src/github/rate-limits.js";

describe("parseSecondsHeader", () => {
    it("distinguishes a missing header from a present zero", () => {
        expect(parseSecondsHeader(undefined)).toStrictEqual({
            kind: "missing",
        });
        expect(parseSecondsHeader("0")).toStrictEqual({
            kind: "valid",
            seconds: 0,
        });
    });

    it.each(["", "-1", "1.5", "120seconds", "120 "])(
        "rejects a non-whole-seconds value: %j",
        (rawValue) => {
            expect(parseSecondsHeader(rawValue)).toStrictEqual({
                kind: "invalid",
                rawValue,
            });
        },
    );

    it("rejects a digit string outside JavaScript's safe integer range", () => {
        const rawValue = "9007199254740992";
        expect(parseSecondsHeader(rawValue)).toStrictEqual({
            kind: "invalid",
            rawValue,
        });
    });
});
