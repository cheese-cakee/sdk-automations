/**
 * A top-level directory holds workspace packages, or it is one of the two
 * knowledge roots — design/ (internal why) and docs/ (users). Clutter regrows
 * quietly, one uncontested directory at a time (D86, D95, D97).
 *
 * The package root is DERIVED from the workspace file rather than spelled
 * `packages`, so the rule holds wherever the packages sit (D95).
 */

import { describe, expect, it } from "vitest";
import { trackedFiles, workspacePackages } from "./repository.js";

/** The first segment of every workspace entry — today, just `packages`. */
export function packageRoots(entries: readonly string[]): Set<string> {
    return new Set(entries.map((entry) => entry.split("/", 1)[0]!));
}

function topLevelOffenders(
    files: readonly string[],
    packages: ReadonlySet<string>,
    knowledge: ReadonlySet<string>,
): string[] {
    const roots = new Set(
        files.filter((path) => path.includes("/")).map((path) => path.split("/", 1)[0]!),
    );
    return [...roots].filter(
        (name) => !name.startsWith(".") && !packages.has(name) && !knowledge.has(name),
    );
}

describe("the top level holds packages and two knowledge roots", () => {
    const KNOWLEDGE = new Set(["design", "docs"]);

    it("every top-level directory is a package root or a named root", () => {
        const packages = packageRoots(workspacePackages());
        expect(topLevelOffenders(trackedFiles(), packages, KNOWLEDGE)).toEqual([]);
    });

    it("the package root is read from the workspace file, not assumed", () => {
        // Guards the derivation: a workspace file that stopped listing paths
        // would empty this set and make the check above flag the packages.
        expect(packageRoots(workspacePackages())).toEqual(new Set(["packages"]));
        expect(packageRoots(["core", "store"])).toEqual(new Set(["core", "store"]));
    });

    it("proves the rule can fail", () => {
        // Negative control: the predicate must still flag a real offender
        // rather than have gone vacuous.
        const packages = packageRoots(workspacePackages());
        expect(
            topLevelOffenders(
                ["audit/report.md", "planning/plan.md", "output/result.json"],
                packages,
                KNOWLEDGE,
            ),
        ).toEqual(["audit", "planning", "output"]);
    });
});
