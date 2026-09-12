/**
 * The Node floor is one fact and this is the one place it is locked: every
 * workspace package's `engines.node` is the oldest runtime CI's test matrix
 * actually runs. Nothing here hardcodes the number — the matrix IS the fact
 * and the manifests are held to it, the same shape as `enumerations.test.ts`
 * (D76). The restatements elsewhere (the README badge, CONTRIBUTING's setup
 * paragraph, dependabot's `@types/node` comment) are prose for humans and are
 * no longer read back: five assertions of one number was the ceremony, not
 * the safety.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, workspacePackages } from "./repository.js";

/** The `engines.node` value a package.json declares, or undefined if absent. */
function engineNode(packageJsonText: string): string | undefined {
    return (JSON.parse(packageJsonText) as { engines?: { node?: string } }).engines?.node;
}

/** The `node:` values in ci.yml's `test` job matrix, e.g. `[24, 25]` → `[24, 25]`. */
function ciMatrixNodeVersions(ciYamlText: string): number[] {
    const match = /node:\s*\[\s*([\d,\s]+)\]/.exec(ciYamlText);
    return match ? match[1]!.split(",").map((n) => Number(n.trim())) : [];
}

/** The floor the matrix sets: the oldest major CI runs the suite on. */
function ciFloor(ciYamlText: string): number {
    const tested = ciMatrixNodeVersions(ciYamlText);
    return tested.length > 0 ? Math.min(...tested) : Number.NaN;
}

/** Each workspace package's declared value, keyed by its `pnpm-workspace.yaml` entry. */
function declaredNodeFloors(): Map<string, string | undefined> {
    const floors = new Map<string, string | undefined>();
    for (const pkg of workspacePackages()) {
        const text = readFileSync(join(repoRoot, pkg, "package.json"), "utf8");
        floors.set(pkg, engineNode(text));
    }
    return floors;
}

describe("the Node floor", () => {
    it("is the CI matrix's oldest major, in every workspace package", () => {
        const ci = readFileSync(join(repoRoot, ".github", "workflows", "ci.yml"), "utf8");
        const expected = `>=${ciFloor(ci)}`;
        const declared = [...declaredNodeFloors()].map(([pkg, value]) => `${pkg}: ${value}`);

        expect(declared.length).toBeGreaterThan(0);
        expect(declared).toEqual(workspacePackages().map((pkg) => `${pkg}: ${expected}`));
    });

    it("proves the check can fail", () => {
        // A package with no engines field, and one that disagrees with the matrix.
        expect(engineNode('{"name": "x"}')).toBeUndefined();
        expect(engineNode('{"engines": {"node": ">=23.4"}}')).not.toBe(">=24");
        // A matrix that never runs the floor the manifests declare.
        expect(ciFloor("node: [25, 26]")).not.toBe(24);
        // A matrix that cannot be read at all is not silently a pass.
        expect(ciFloor("node: latest")).toBeNaN();
    });
});
