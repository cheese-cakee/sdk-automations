/**
 * Shared by every check: where the repository is, and what packages it holds.
 * Split out of the original repo-artifacts.test.ts when the invariants became
 * one-file-per-invariant (D89).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Package list comes from the workspace file rather than a hard-coded array,
 * so this keeps working when `probes/` is deleted at stage four and when
 * later packages arrive. A test that needs editing to stay correct is a test
 * that quietly stops being run.
 */
export function workspacePackages(): string[] {
    const yaml = readFileSync(join(repoRoot, "pnpm-workspace.yaml"), "utf8");
    return yaml
        .split("\n")
        .map((line) => /^\s*-\s*(.+?)\s*$/.exec(line)?.[1])
        .filter((name): name is string => name !== undefined);
}
