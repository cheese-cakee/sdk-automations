/**
 * The checks README promises one row per invariant file. This check holds the
 * table and `test/*.test.ts` to each other in both directions, so a new guard
 * cannot become invisible and a deleted guard cannot leave a false promise
 * behind (#92).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, trackedFiles } from "./repository.js";

const README = "packages/dev/checks/README.md";
const TEST_PREFIX = "packages/dev/checks/test/";

interface InvariantRow {
    readonly displayed: string;
    readonly target: string;
}

/** Displayed filename and link target for every invariants-table row. */
export function documentedInvariantRows(markdown: string): InvariantRow[] {
    const section = markdown.split(/^## /m).find((part) => part.startsWith("The invariants"));
    expect(section, 'section "The invariants" exists').toBeDefined();
    return [...(section ?? "").matchAll(/^\| \[`([^`]+\.test\.ts)`\]\((test\/[^)]+)\) \|/gm)]
        .map((match) => ({ displayed: match[1]!, target: match[2]! }))
        .sort((left, right) => left.displayed.localeCompare(right.displayed));
}

/** Linked `.test.ts` basenames in the README's invariants table. */
export function documentedInvariantFiles(markdown: string): string[] {
    return documentedInvariantRows(markdown).map(({ displayed }) => displayed);
}

function invariantFiles(files: readonly string[]): string[] {
    return files
        .filter(
            (file) =>
                file.startsWith(TEST_PREFIX) &&
                !file.slice(TEST_PREFIX.length).includes("/") &&
                file.endsWith(".test.ts"),
        )
        .map((file) => file.slice(TEST_PREFIX.length))
        .sort();
}

describe("the invariants table lists every check file", () => {
    const tracked = trackedFiles();
    const documented = documentedInvariantFiles(readFileSync(join(repoRoot, README), "utf8"));
    const actual = invariantFiles(tracked);

    it("the table and test directory agree in both directions", () => {
        expect(documented).toEqual(actual);
    });

    it("each displayed filename links to that same file", () => {
        const rows = documentedInvariantRows(readFileSync(join(repoRoot, README), "utf8"));
        expect(rows.filter(({ displayed, target }) => target !== `test/${displayed}`)).toEqual([]);
    });

    it("proves a missing row and a stale row both fail", () => {
        const withoutThisRow = documented.filter((file) => file !== "invariants.test.ts");
        expect(withoutThisRow).not.toEqual(actual);

        const withGoneFile = [...documented, "gone.test.ts"].sort();
        expect(withGoneFile).not.toEqual(actual);

        expect(
            invariantFiles([`${TEST_PREFIX}one.test.ts`, `${TEST_PREFIX}repository.ts`]),
        ).toEqual(["one.test.ts"]);

        const mislinked = documentedInvariantRows(
            "## The invariants\n\n| File | Purpose |\n|---|---|\n| [`one.test.ts`](test/two.test.ts) | x |",
        );
        expect(mislinked[0]).toEqual({ displayed: "one.test.ts", target: "test/two.test.ts" });
        expect(mislinked[0]!.target).not.toBe(`test/${mislinked[0]!.displayed}`);
    });
});
