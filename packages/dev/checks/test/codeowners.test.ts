/**
 * Every non-comment pattern in `.github/CODEOWNERS` matches at least one
 * tracked file. A stale pattern does not error, it silently owns nothing, and
 * the `*` default hides the gap — silent when wrong, like the mutate glob (D89).
 *
 * Matching is asked of `git ls-files --exclude-from` rather than reimplemented:
 * the patterns are gitignore syntax, not globs, and a hand-rolled
 * approximation would need its own tests to be trustworthy.
 */

import { describe, expect, it } from "vitest";
import { withTempDir } from "@hiero-hackers/automation-testkit";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { lines, repoRoot } from "./repository.js";

/** Each non-comment CODEOWNERS line's pattern — the first whitespace-separated token. */
function patterns(): string[] {
    const text = readFileSync(join(repoRoot, ".github", "CODEOWNERS"), "utf8");
    return lines(text)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"))
        .map((line) => line.split(/\s+/)[0]!);
}

/** Tracked files a gitignore-style pattern matches, per git's own rule rather than ours. */
function matches(pattern: string): string[] {
    return withTempDir("codeowners-check-", (dir) => {
        const excludeFile = join(dir, "pattern");
        writeFileSync(excludeFile, `${pattern}\n`);
        return lines(
            execFileSync("git", ["ls-files", "--cached", "-i", `--exclude-from=${excludeFile}`], {
                cwd: repoRoot,
                encoding: "utf8",
            }),
        ).filter(Boolean);
    });
}

describe("every CODEOWNERS pattern matches something", () => {
    it("has patterns to check", () => {
        // An empty list would pass every assertion below in silence — the same
        // vacuous shape the patterns are being guarded against.
        expect(patterns().length).toBeGreaterThan(0);
    });

    it.each(patterns())("%s matches at least one tracked file", (pattern) => {
        expect(matches(pattern), `${pattern} matches nothing`).not.toEqual([]);
    });

    it("proves the check can fail", () => {
        expect(matches("/this/path/does/not/exist")).toEqual([]);
    });
});
