/**
 * The pre-commit hook is opt-in convenience CI never executes, so nothing else
 * would notice it rotting. Two facts keep it honest: its staged-file pathspec
 * confines Prettier to the same tree as package.json's `format:check` glob, so
 * hook and CI cannot disagree about which files the formatter owns; and it
 * keeps its executable bit, because git skips a non-executable hook silently
 * rather than erroring.
 */

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./repository.js";

const HOOK = ".githooks/pre-commit";

/**
 * The scope a pattern confines a tool to: root directory and extension. A git
 * pathspec and a prettier glob are different syntaxes for the same scope, so
 * the comparison is on what they cover rather than on the spelling.
 */
export function scopeOf(pattern: string): { root: string; extension: string } {
    return {
        root: pattern.split("/", 1)[0]!,
        extension: pattern.slice(pattern.lastIndexOf(".")),
    };
}

/** The quoted pathspec the hook hands `git diff --cached`. */
function hookPathspec(): string {
    const script = readFileSync(join(repoRoot, HOOK), "utf8");
    const match = /git diff --cached[^\n]* -- '([^']+)'/.exec(script);
    if (match === null) {
        throw new Error(`${HOOK} no longer stages via a single-quoted pathspec`);
    }
    return match[1]!;
}

/** The quoted glob package.json's format:check script hands prettier. */
function formatCheckGlob(): string {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
        scripts: Record<string, string>;
    };
    const match = /"([^"]+)"/.exec(pkg.scripts["format:check"]!);
    if (match === null) {
        throw new Error("format:check no longer carries a quoted glob");
    }
    return match[1]!;
}

describe("the pre-commit hook stays locked to the tools it fronts", () => {
    it("covers the same tree as CI's format check", () => {
        expect(scopeOf(hookPathspec())).toEqual(scopeOf(formatCheckGlob()));
    });

    it("keeps its executable bit", () => {
        // `git ls-files -s` reports the tracked mode; the worktree bit can
        // lie on filesystems that don't store one.
        const entry = execFileSync("git", ["ls-files", "-s", "--", HOOK], {
            cwd: repoRoot,
            encoding: "utf8",
        });
        expect(entry, `${HOOK} is not tracked`).not.toBe("");
        expect(entry.split(" ", 1)[0]).toBe("100755");
    });

    it("proves the scope comparison can fail", () => {
        // A hook staging outside packages/, or a format glob that moved, must
        // register as a mismatch rather than a vacuous pass.
        expect(scopeOf("*.ts")).not.toEqual(scopeOf("packages/**/*.ts"));
        expect(scopeOf("packages/*.js")).not.toEqual(scopeOf("packages/**/*.ts"));
    });
});
