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

function gitListed(...flags: readonly string[]): string[] {
    return execFileSync("git", ["ls-files", "-z", ...flags], {
        cwd: repoRoot,
        encoding: "utf8",
    })
        .split("\0")
        .filter(Boolean)
        .map(normalizeRepoPath);
}

/**
 * What the index records. The one corpus for a check ABOUT tracking — the
 * never-tracked invariant asks what git holds, and a working-tree file it has
 * not been told about is exactly the case it must not count.
 */
export function trackedFiles(): string[] {
    return gitListed();
}

/**
 * What `git add -A` would record: tracked files still on disk, plus untracked
 * files the ignore rules admit. The corpus for every check about the
 * repository's CONTENT.
 *
 * The index alone was the corpus until D143, and it cost every build the same
 * round: a new module was invisible to the citation checks until committed,
 * and a tracked document naming it failed until then, so new files went
 * unnamed in prose for one commit. The earlier concern — untracked scratch
 * files feeding every invariant — is answered by the ignore rules: a file the
 * rules admit is a file the next `git add -A` commits, and a check that sees
 * it first is doing its job.
 */
export function repositoryFiles(): string[] {
    const deleted = new Set(gitListed("--deleted"));
    return gitListed("--cached", "--others", "--exclude-standard").filter(
        (path) => !deleted.has(path),
    );
}

/**
 * Package list comes from the workspace file rather than a hard-coded array,
 * so this keeps working as packages are renamed and as later ones arrive. A
 * test that needs editing to stay correct is a test that quietly stops being
 * run.
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

/** Every markdown file the repository holds, read. The corpus for any check about prose. */
export function markdownDocuments(): Document[] {
    return repositoryFiles()
        .filter((path) => path.endsWith(".md"))
        .map((path) => ({ doc: path, text: readFileSync(join(repoRoot, path), "utf8") }));
}

/** Every row ever written, and the file the D-id check resolves against. */
export const REGISTER_HISTORY = "design/history/decisions.md";

/**
 * The register: the binding subset and the history it is copied from. No
 * reference check reads either.
 */
export const REGISTER = ["design/constraints.md", "design/history/"];

/**
 * The corpus for the reference checks — every markdown document except the
 * register's two files.
 *
 * A row is written on the day it is taken and is never edited afterwards, so
 * it names the tree as it WAS: files that have since moved, been renamed or
 * been deleted. That holds for a row copied into the constraints page exactly
 * as it holds for one left in history, so both leave this corpus rather than
 * carving themselves out of it row by row.
 */
export function referenceDocuments(): Document[] {
    return markdownDocuments().filter(
        ({ doc }) => !REGISTER.some((entry) => doc === entry || doc.startsWith(entry)),
    );
}

/**
 * Every TypeScript file under the named directories of every workspace
 * package, repository-relative. Package list from the workspace file for the
 * reason `workspacePackages` exists: a hard-coded one leaves a newly arrived
 * package unscanned, and a check nobody edits is a check that stopped running.
 *
 * Filtered from git's own listing rather than walked with `readdirSync`, so
 * the ignore rules decide what counts and a build directory or a stray editor
 * file never reaches an invariant (`repositoryFiles` says which listing).
 */
export function sourceFiles(directories: readonly string[] = ["src", "test"]): string[] {
    const prefixes = workspacePackages().flatMap((workspacePackage) =>
        directories.map((directory) => `${workspacePackage}/${directory}/`),
    );
    return repositoryFiles().filter(
        (path) => path.endsWith(".ts") && prefixes.some((prefix) => path.startsWith(prefix)),
    );
}
