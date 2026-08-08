/**
 * Stryker's mutate globs cover every core module — the invariant born from
 * `src/*.ts` silently skipping three modules the day they moved into a
 * directory. Split from repo-artifacts.test.ts (D89).
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { normalizeRepoPath, repoRoot } from "./helpers.js";

/**
 * Minimal glob matcher — enough for the patterns Stryker configs use.
 *
 * Single pass, deliberately. The obvious implementation is a chain of
 * `.replace()` calls, and it is wrong: expanding `**​/` inserts `(?:…/)*`
 * into the string, and the *next* replacement then rewrites the `*` and `?`
 * of the token just emitted. The first draft here did exactly that and
 * produced a regex matching nothing at all.
 */
function globToRegExp(glob: string): RegExp {
    let body = "";
    for (let i = 0; i < glob.length; i++) {
        const char = glob[i]!;
        if (char === "*") {
            if (glob[i + 1] === "*") {
                if (glob[i + 2] === "/") {
                    body += "(?:[^/]+/)*"; // any number of directories
                    i += 2;
                } else {
                    body += ".*";
                    i += 1;
                }
            } else {
                body += "[^/]*"; // one segment only
            }
        } else if (char === "?") {
            body += "[^/]";
        } else {
            body += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
        }
    }
    return new RegExp(`^${body}$`);
}

describe("mutation testing covers every core module", () => {
    const config = JSON.parse(
        readFileSync(join(repoRoot, "packages", "core", "stryker.config.json"), "utf8"),
    ) as { mutate: string[]; thresholds: { break: number | null } };

    const patterns = config.mutate.map(globToRegExp);
    const srcRoot = join(repoRoot, "packages", "core", "src");
    const modules = (readdirSync(srcRoot, { recursive: true }) as string[])
        .filter((rel) => rel.endsWith(".ts"))
        .map((rel) => `src/${normalizeRepoPath(rel)}`);

    it("finds the core modules", () => {
        expect(modules.length).toBeGreaterThan(5);
        // The move that caused the regression: a nested module must exist,
        // or this test cannot detect a single-level glob at all.
        expect(modules).toContain("src/github/failures.ts");
    });

    it("matches every module against the mutate globs", () => {
        const unmatched = modules.filter(
            (module) => !patterns.some((pattern) => pattern.test(module)),
        );
        expect(unmatched).toEqual([]);
    });

    /**
     * Negative control, in both directions. The first draft asserted only
     * that a single-level glob REJECTS a nested path — and passed while the
     * matcher was so broken it rejected everything, including the paths it
     * was supposed to accept. A control that can only observe rejection
     * cannot tell "correctly strict" from "entirely broken".
     */
    it("proves the matcher can both accept and reject", () => {
        const singleLevel = globToRegExp("src/*.ts");
        expect(singleLevel.test("src/config.ts")).toBe(true);
        expect(singleLevel.test("src/github/failures.ts")).toBe(false);

        const recursive = globToRegExp("src/**/*.ts");
        expect(recursive.test("src/config.ts")).toBe(true);
        expect(recursive.test("src/github/failures.ts")).toBe(true);
        expect(recursive.test("src/github/deep/nested.ts")).toBe(true);
        expect(recursive.test("test/config.test.ts")).toBe(false);
    });

    /**
     * D40's sibling question, answered in config rather than convention: a
     * `break` of `null` means the mutation score can never fail anything, so
     * a module could drop to zero in CI and pass. It has to be a number.
     */
    it("sets a break threshold, so the score can fail a build", () => {
        expect(typeof config.thresholds.break).toBe("number");
    });
});
