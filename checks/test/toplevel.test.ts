/**
 * The top level holds packages and three knowledge roots — D86's sentence as
 * a test. Split from repo-artifacts.test.ts (D89).
 */

import { describe, expect, it } from "vitest";
import { trackedFiles, workspacePackages } from "./helpers.js";

function topLevelOffenders(
    files: readonly string[],
    packages: ReadonlySet<string>,
    knowledge: ReadonlySet<string>,
): string[] {
    const roots = new Set(
        files
            .filter((path) => path.includes("/"))
            .map((path) => path.split("/", 1)[0]!),
    );
    return [...roots].filter(
        (name) =>
            !name.startsWith(".") &&
            !packages.has(name) &&
            !knowledge.has(name),
    );
}

/**
 * The consolidation's real product is a sentence: a top-level directory is a
 * workspace package, or it is one of three knowledge roots — design/
 * (internal), docs/ (users), examples/ (users, executable). audit/ and
 * planning/ existed because no such rule did; this keeps the next five
 * packages from re-growing the clutter.
 */
describe("the top level holds packages and three knowledge roots", () => {
    const KNOWLEDGE = new Set(["design", "docs", "examples"]);
    it("every top-level directory is a package or a named root", () => {
        const packages = new Set(workspacePackages());
        expect(topLevelOffenders(trackedFiles(), packages, KNOWLEDGE)).toEqual([]);
    });

    it("proves the rule can fail", () => {
        // audit/ was a real offender until 2026-08-06; assert the predicate
        // would still flag it rather than having gone vacuous.
        const packages = new Set(workspacePackages());
        expect(
            topLevelOffenders(
                ["audit/report.md", "planning/plan.md", "output/result.json"],
                packages,
                KNOWLEDGE,
            ),
        ).toEqual(["audit", "planning", "output"]);
    });
});
