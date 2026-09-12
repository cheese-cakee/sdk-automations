import { describe, expect, it } from "vitest";
import { mutationScore } from "./store-mutation-threshold.js";

describe("the store keeps its mutation ratchet after the package merge", () => {
    it("scores only measured store mutants", () => {
        const report = {
            files: {
                "src/store/store.ts": {
                    mutants: [
                        { status: "Killed" },
                        { status: "Timeout" },
                        { status: "RuntimeError" },
                        { status: "Survived" },
                        { status: "Ignored" },
                    ],
                },
                "src/shell/main.ts": { mutants: [{ status: "NoCoverage" }] },
            },
        };
        expect(mutationScore(report, "src/store/")).toBeCloseTo(200 / 3);
        expect(mutationScore(report, "src/adapter/")).toBeNull();
    });
});
