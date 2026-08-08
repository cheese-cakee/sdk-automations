/**
 * Shared by every check: where the repository is, and what packages it holds.
 * Split out of the original repo-artifacts.test.ts when the invariants became
 * one-file-per-invariant (D89).
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Three levels: test/ → checks/ → packages/ → the repository root.
export const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

/** Use one representation for paths reported by Node and Git on every OS. */
export function normalizeRepoPath(path: string): string {
    return path.replaceAll("\\", "/");
}

/** Make parsing independent of the checkout's configured line endings. */
export function normalizeNewlines(text: string): string {
    return text.replace(/\r\n?/g, "\n");
}

export function lines(text: string): string[] {
    return normalizeNewlines(text).split("\n");
}

/** Repository invariants inspect versioned material, not local worktree output. */
export function trackedFiles(): string[] {
    return execFileSync("git", ["ls-files", "-z"], {
        cwd: repoRoot,
        encoding: "utf8",
    })
        .split("\0")
        .filter(Boolean)
        .map(normalizeRepoPath);
}

/**
 * Package list comes from the workspace file rather than a hard-coded array,
 * so this keeps working when `probes/` is deleted at stage four and when
 * later packages arrive. A test that needs editing to stay correct is a test
 * that quietly stops being run.
 */
export function workspacePackages(): string[] {
    const yaml = readFileSync(join(repoRoot, "pnpm-workspace.yaml"), "utf8");
    return lines(yaml)
        .map((line) => /^\s*-\s*(.+?)\s*$/.exec(line)?.[1])
        .filter((name): name is string => name !== undefined);
}
