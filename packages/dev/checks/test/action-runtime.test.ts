/**
 * The Action runs on the oldest Node the CI matrix tests, and runs a bundle
 * the build puts under `packages/runtime/dist/`. A manifest that names a newer
 * runtime than CI proves, or an entry outside the build's output, ships an
 * Action nobody has run.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { repoRoot } from "./repository.js";

const DIST = "packages/runtime/dist/";

/** The oldest major the `test` job's matrix runs (the derivation `node-floor.test.ts` holds). */
function ciFloor(ciYamlText: string): number {
    const match = /node:\s*\[\s*([\d,\s]+)\]/.exec(ciYamlText);
    return match ? Math.min(...match[1]!.split(",").map((n) => Number(n.trim()))) : Number.NaN;
}

function runsOf(manifestText: string): { using?: unknown; main?: unknown } {
    return (parse(manifestText) as { runs?: { using?: unknown; main?: unknown } }).runs ?? {};
}

function isUnderDist(main: unknown): boolean {
    return typeof main === "string" && main.startsWith(DIST) && !main.includes("..");
}

describe("the Action's runtime", () => {
    const runs = runsOf(readFileSync(join(repoRoot, "action.yml"), "utf8"));

    it("is the Node major CI's matrix runs oldest", () => {
        const ci = readFileSync(join(repoRoot, ".github", "workflows", "ci.yml"), "utf8");
        expect(runs.using).toBe(`node${ciFloor(ci)}`);
    });

    it("starts from a file the runtime package builds", () => {
        expect(isUnderDist(runs.main), `runs.main is ${String(runs.main)}`).toBe(true);
    });

    it("proves the check can fail", () => {
        expect(ciFloor("node: [25, 26]")).not.toBe(24);
        expect(ciFloor("node: latest")).toBeNaN();
        expect(runsOf("runs:\n  using: node20\n").using).not.toBe("node24");
        expect(isUnderDist("src/action.js")).toBe(false);
        expect(isUnderDist("packages/runtime/dist/../src/x.js")).toBe(false);
        expect(isUnderDist(undefined)).toBe(false);
    });
});
