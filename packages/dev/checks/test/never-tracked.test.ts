/**
 * Git tracks nothing under any local-only layer — an invariant over LAYERS,
 * not a fact about the lab (D99). Each layer holds material that must never
 * reach a commit behind one `.gitignore` line, which a `git add -f` or a
 * directory move bypasses in silence.
 *
 * Three assertions per layer, deliberately overlapping: the rule is still
 * WRITTEN (fails before a leak, not after), it still WORKS (`git check-ignore`
 * catches a negation or a stale pattern), and nothing under it is TRACKED
 * (the invariant proper, and the only one a forced add cannot slip past).
 */

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lines, repoRoot } from "./repository.js";

interface Layer {
    /** The exact `.gitignore` line, and the prefix git is asked about. */
    readonly rule: string;
    /** What would leak. Prose, so a failure explains itself. */
    readonly holds: string;
}

const LAYERS: readonly Layer[] = [
    {
        rule: "packages/dev/lab/harness/",
        holds: "era-1 harness code and the private, unscrubbed evidence archive",
    },
    {
        rule: "packages/dev/lab/evidence/",
        holds: "captures staged for human review before promotion (protocol 7.1)",
    },
    {
        rule: "packages/dev/lab/.env",
        holds: "the sandbox App's credentials",
    },
    {
        rule: "packages/shell/data/",
        holds: "the operational store — RAW webhook payload bytes — and the decision journal naming real repositories",
    },
];

const tracked = (path: string): string[] =>
    lines(
        execFileSync("git", ["ls-files", "--", path], {
            cwd: repoRoot,
            encoding: "utf8",
        }),
    ).filter(Boolean);

/** `git check-ignore` exits 1 when the path is NOT ignored, so a throw is a false. */
function ignored(path: string): boolean {
    try {
        execFileSync("git", ["check-ignore", "-q", "--", path], {
            cwd: repoRoot,
            stdio: "ignore",
        });
        return true;
    } catch {
        return false;
    }
}

describe("the local-only layers stay out of the repository", () => {
    const ignoreLines = lines(readFileSync(join(repoRoot, ".gitignore"), "utf8"));

    it("covers every layer that exists", () => {
        // A silently emptied table would pass every assertion below.
        expect(LAYERS.length).toBeGreaterThanOrEqual(4);
        expect(LAYERS.map((l) => l.rule)).toContain("packages/shell/data/");
    });

    it.each(LAYERS)("$rule is still ignored by rule", ({ rule }) => {
        expect(ignoreLines).toContain(rule);
    });

    it.each(LAYERS)("$rule is still ignored in effect", ({ rule }) => {
        // A written rule can stop matching: `lab/harness/` after the directory
        // became the lab harness path above (D95), later filed under `packages/dev/`.
        expect(ignored(rule)).toBe(true);
    });

    it.each(LAYERS)("git tracks nothing under $rule ($holds)", ({ rule, holds }) => {
        expect(tracked(rule), `${rule} would leak ${holds}`).toEqual([]);
    });

    it("proves the instruments can fail", () => {
        // The same commands answer the other way on a tracked, non-ignored
        // path, so an empty result above means "nothing tracked".
        expect(tracked("packages/core/package.json")).toEqual(["packages/core/package.json"]);
        expect(ignored("packages/core/package.json")).toBe(false);
    });
});
