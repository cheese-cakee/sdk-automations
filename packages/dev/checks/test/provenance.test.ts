/**
 * `packages/core/src/github/README.md`'s provenance table — file, probing
 * experiment, date — matches the facts the code stamps on each pattern. One
 * fact in two homes: the table was already wrong when this lock was written,
 * crediting experiment 6.4 for facts the code stamps 6.1.
 * Named for its target rather than its origin (D89, D99).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BODY_PATTERNS } from "@hiero-hackers/automation-core";
import { normalizeNewlines, repoRoot, trackedFiles } from "./repository.js";

describe("the perishable-facts provenance table matches the code", () => {
    const tracked = new Set(trackedFiles());
    const readme = normalizeNewlines(
        readFileSync(join(repoRoot, "packages/core/src/github/README.md"), "utf8"),
    );
    const row = readme.split("\n").find((line) => line.startsWith("| `failures.ts` |"));

    it("has a row for failures.ts", () => {
        expect(row).toBeDefined();
    });

    it("the row's date is every pattern's probedAt", () => {
        for (const [name, entry] of Object.entries(BODY_PATTERNS)) {
            expect(row, `date for ${name}`).toContain(entry.probedAt);
        }
    });

    it("the row credits every experiment the code cites, and no other", () => {
        const inCode = new Set(Object.values(BODY_PATTERNS).map((entry) => entry.experiment));
        const inRow = new Set(
            [...(row ?? "").matchAll(/\b(\d+\.\d+)\b/g)]
                .map((m) => m[1]!)
                // the date's day-fragments are not experiment numbers
                .filter((n) => !(row ?? "").includes(`-${n}`)),
        );
        expect([...inRow].sort()).toEqual([...inCode].sort());
    });

    it("every file the table names exists in src/github", () => {
        const named = [...readme.matchAll(/^\| `([a-z-]+\.ts)` \|/gm)].map((m) => m[1]!);
        expect(named.length).toBeGreaterThan(2);
        for (const name of named) {
            expect(
                tracked.has(`packages/core/src/github/${name}`),
                `${name} exists and is tracked`,
            ).toBe(true);
        }
    });
});
