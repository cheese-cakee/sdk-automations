/**
 * Shared by every check: where the repository is, and what packages it holds.
 * Split out of the original repo-artifacts.test.ts when the invariants became
 * one-file-per-invariant (D89).
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Four levels: test/ → checks/ → dev/ → packages/ → the repository root.
export const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

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

/** Where the shipped documentation lives. */
export const docsDir = join(repoRoot, "docs");

/**
 * The shipped example configurations, listed once: one check parses them and
 * another checks the quickstart's links to them, and two derivations of this
 * directory would let a file quietly fall out of one side (the D112 move had
 * to edit every hand-walked `../../../` in this package one by one).
 */
export function exampleFiles(): string[] {
    return readdirSync(join(docsDir, "examples"), { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".yml"))
        .map((entry) => entry.name)
        .sort();
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

/** A document and its text, the pair every reference check scans. */
export interface Document {
    readonly doc: string;
    readonly text: string;
}

/** Every tracked markdown file, read. The corpus for any check about prose. */
export function markdownDocuments(): Document[] {
    return trackedFiles()
        .filter((path) => path.endsWith(".md"))
        .map((path) => ({ doc: path, text: readFileSync(join(repoRoot, path), "utf8") }));
}

/**
 * Every TypeScript file under the named directories of every workspace
 * package, repository-relative. Package list from the workspace file for the
 * reason `workspacePackages` exists: a hard-coded one leaves a newly arrived
 * package unscanned, and a check nobody edits is a check that stopped running.
 *
 * Filtered from the tracked list rather than walked with `readdirSync`, which
 * fed untracked scratch files to every invariant built on this — a local
 * failure CI could not reproduce, and the opposite of this module's rule that
 * invariants inspect versioned material.
 */
export function sourceFiles(directories: readonly string[] = ["src", "test"]): string[] {
    const prefixes = workspacePackages().flatMap((workspacePackage) =>
        directories.map((directory) => `${workspacePackage}/${directory}/`),
    );
    return trackedFiles().filter(
        (path) => path.endsWith(".ts") && prefixes.some((prefix) => path.startsWith(prefix)),
    );
}
