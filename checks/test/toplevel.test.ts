/**
 * The top level holds packages and three knowledge roots — D86's sentence as
 * a test. Split from repo-artifacts.test.ts (D89).
 */

import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { repoRoot, workspacePackages } from "./helpers.js";

/**
 * The consolidation's real product is a sentence: a top-level directory is a
 * workspace package, or it is one of three knowledge roots — design/
 * (internal), docs/ (users), examples/ (users, executable). audit/ and
 * planning/ existed because no such rule did; this keeps the next five
 * packages from re-growing the clutter.
 */
describe("the top level holds packages and three knowledge roots", () => {
    const KNOWLEDGE = new Set(["design", "docs", "examples"]);
    // On disk always, never in the repository. The lab itself is a
    // workspace package now (D88); only its inner layer is local.
    const LOCAL_ONLY = new Set(["node_modules"]);

    it("every top-level directory is a package or a named root", () => {
        const packages = new Set(workspacePackages());
        const offenders = readdirSync(repoRoot, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .filter(
                (name) =>
                    !name.startsWith(".") &&
                    !packages.has(name) &&
                    !KNOWLEDGE.has(name) &&
                    !LOCAL_ONLY.has(name),
            );
        expect(offenders).toEqual([]);
    });

    it("proves the rule can fail", () => {
        // audit/ was a real offender until 2026-08-06; assert the predicate
        // would still flag it rather than having gone vacuous.
        const packages = new Set(workspacePackages());
        for (const name of ["audit", "planning"]) {
            expect(packages.has(name)).toBe(false);
            expect(KNOWLEDGE.has(name)).toBe(false);
            expect(LOCAL_ONLY.has(name)).toBe(false);
        }
    });
});
