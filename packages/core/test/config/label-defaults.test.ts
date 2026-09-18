/** Every meaning has a label the App can define, in GitHub's own spelling of a colour. */

import { describe, expect, it } from "vitest";
import { DEFAULT_LABEL_MAPPINGS, LABEL_DEFAULTS, MAPPABLE_MEANINGS } from "../../src/index.js";

describe("the label defaults", () => {
    it("cover every meaning with a six-digit colour and a description", () => {
        for (const meaning of MAPPABLE_MEANINGS) {
            expect(LABEL_DEFAULTS[meaning].color).toMatch(/^[0-9a-f]{6}$/);
            expect(LABEL_DEFAULTS[meaning].description.length).toBeGreaterThan(0);
        }
    });

    it("give no two meanings the same colour or spelling", () => {
        const colours = MAPPABLE_MEANINGS.map((meaning) => LABEL_DEFAULTS[meaning].color);
        expect(new Set(colours).size).toBe(colours.length);
        const names = MAPPABLE_MEANINGS.map((meaning) => LABEL_DEFAULTS[meaning].name);
        expect(new Set(names).size).toBe(names.length);
        expect(DEFAULT_LABEL_MAPPINGS.needsReview).toBe("status: needs review");
    });
});
