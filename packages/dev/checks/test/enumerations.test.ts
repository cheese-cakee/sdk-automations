/**
 * Every exported const array in core derives its union (D76). A hand-written
 * union beside its array compiles, so the drift is invisible until a value
 * the type never heard of gets through. One invariant per file (D89).
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { normalizeRepoPath, repoRoot } from "./repository.js";

describe("enumerations are declared once", () => {
    const sources = (
        readdirSync(join(repoRoot, "packages", "core", "src"), {
            recursive: true,
        }) as string[]
    )
        .filter((rel) => rel.endsWith(".ts"))
        .map((rel) => ({
            file: `src/${normalizeRepoPath(rel)}`,
            text: readFileSync(join(repoRoot, "packages", "core", "src", rel), "utf8"),
        }));

    it("finds the core sources", () => {
        expect(sources.length).toBeGreaterThan(5);
    });

    it("every exported const array has a union derived from it", () => {
        const orphans: string[] = [];
        for (const { file, text } of sources) {
            for (const match of text.matchAll(/export const ([A-Z][A-Z0-9_]*) = \[/g)) {
                const name = match[1]!;
                // The union must be derived, in the same file, from this array.
                if (!text.includes(`(typeof ${name})[number]`)) {
                    orphans.push(`${file}: ${name}`);
                }
            }
        }
        expect(orphans).toEqual([]);
    });

    it("proves the check can fail", () => {
        // Negative control: without this, the assertion above could pass on a
        // detector that never matches anything.
        const fake = 'export const COLOURS = ["red", "blue"] as const;';
        const found = [...fake.matchAll(/export const ([A-Z][A-Z0-9_]*) = \[/g)];
        expect(found).toHaveLength(1);
        expect(fake.includes("(typeof COLOURS)[number]")).toBe(false);
    });
});
