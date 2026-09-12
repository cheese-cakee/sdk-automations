/**
 * Every shipped capability's folder holds the design page the generators read,
 * with the title they read it by.
 *
 * The title is not decoration: `docs/capabilities.md`'s purpose column is the
 * half after the em-dash, so a page titled any other way documents the
 * capability with its own first line. That rule used to be a `throw` inside
 * `capabilities.ts`, which every check calling `shippedCapabilities()` failed
 * on at once — five red files, each reporting a title. It is one assertion
 * here, and the rule is in the message.
 * One invariant per file (D89).
 */

import { describe, expect, it } from "vitest";
import { DESIGN_TITLE, shippedCapabilities } from "./capabilities.js";

describe("every shipped capability's design page", () => {
    const shipped = shippedCapabilities();

    /** A walk that found nothing passes the loop below in silence. */
    it("finds the shipped folders at all", () => {
        expect(shipped.length).toBeGreaterThan(3);
    });

    it("is titled `# name — purpose`", () => {
        const wrong = shipped
            .filter(({ title }) => !DESIGN_TITLE.test(title))
            .map(({ folder, title }) => `${folder}/design.md: ${JSON.stringify(title)}`);
        expect(
            wrong,
            "a design page's first line must read \"# name — purpose\": a level-one heading, the capability's name in letters and hyphens, a spaced EM-DASH (—, not - or –), then the one-sentence purpose the capability table quotes",
        ).toEqual([]);
    });

    /** The negative control for the shape above: two near misses, both refused. */
    it("refuses a hyphen for the em-dash, and a missing purpose", () => {
        expect(DESIGN_TITLE.test("# intake - walk a new issue")).toBe(false);
        expect(DESIGN_TITLE.test("# intake")).toBe(false);
        expect(DESIGN_TITLE.test("# intake — walk a new issue")).toBe(true);
    });
});
