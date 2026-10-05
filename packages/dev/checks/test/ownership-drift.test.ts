/**
 * The ownership table in `design/contracts/taxonomy.md` §2.1 names each position's writers. The
 * intent screen refuses a meaning a capability did not declare, and core refuses a meaning two
 * capabilities declare, so the shipped declarations ARE the writers: the table must name them.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAPPABLE_MEANINGS } from "@hiero-hackers/automation-core";
import { shippedCapabilities } from "./capabilities.js";
import { normalizeNewlines, repoRoot } from "./repository.js";

const DOC = join(repoRoot, "design", "contracts", "taxonomy.md");

const HEADING = "### 2.1 Current capability interactions";

/** Each row's meaning, and the capabilities its Writer cell names in backticks; prose names none. */
function documentedWriters(markdown: string): [string, string[]][] {
    const section = markdown.split(HEADING)[1]?.split(/^#{2,3} /m)[0] ?? "";
    return [...section.matchAll(/^\|\s*`(\w+)`\s*\|([^|]*)\|/gm)].map(([, meaning, writer]) => [
        meaning!,
        [...writer!.matchAll(/`(\w+)`/g)].map((m) => m[1]!).sort(),
    ]);
}

/** Each meaning, and the shipped capabilities whose `labels` declare it. */
function declaredWriters(): Record<string, string[]> {
    const shipped = shippedCapabilities();
    return Object.fromEntries(
        MAPPABLE_MEANINGS.map((meaning) => [
            meaning,
            shipped
                .filter(({ labels }) => labels.includes(meaning))
                .map(({ name }) => name)
                .sort(),
        ]),
    );
}

describe("taxonomy.md §2.1 names each position's declared writers", () => {
    const documented = documentedWriters(normalizeNewlines(readFileSync(DOC, "utf8")));

    it("lists every position once", () => {
        expect(documented.map(([meaning]) => meaning).sort()).toEqual(
            [...MAPPABLE_MEANINGS].sort(),
        );
    });

    it("names exactly the capabilities that declare each position", () => {
        expect(Object.fromEntries(documented), `update the table under ${HEADING}`).toEqual(
            declaredWriters(),
        );
    });

    it("reads backticked writers, treats prose as no capability, and stops at the next heading", () => {
        const markdown = [
            HEADING,
            "",
            "| Meaning | Writer | Used by |",
            "|---|---|---|",
            "| `ready` | A person | `triageQueue` |",
            "| `needsReview` | `b`, `a` | `a` |",
            "",
            "### 2.2 Next",
            "| `blocked` | `ignored` | |",
        ].join("\n");
        expect(documentedWriters(markdown)).toEqual([
            ["ready", []],
            ["needsReview", ["a", "b"]],
        ]);
    });
});
