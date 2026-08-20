/**
 * The transition tables (`PROFILE_EDGES`) and the state diagrams in
 * `design/contracts/taxonomy.md` are hand copies of each other, so nothing failed
 * when they diverged (D48, D50). Every edge in one appears in the other.
 *
 * (from, to) PAIRS only: arrow prose is written for humans and causes are
 * checked by core's exhaustive matrix, so a cause added without a doc edit
 * still slips through while a whole edge no longer can (D50).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROFILE_EDGES } from "@hiero-hackers/automation-core";
import { repoRoot } from "./repository.js";

const DOC = join(repoRoot, "design", "contracts", "taxonomy.md");

/** Every ```mermaid fence in the document, body only. */
function mermaidBlocks(markdown: string): string[] {
    return [...markdown.matchAll(/```mermaid\r?\n([\s\S]*?)```/g)].map((m) => m[1] ?? "");
}

/**
 * `A --> B: prose` → `A->B`, with mermaid's `[*]` start/end marker
 * normalized to the tables' `null`.
 */
function edgePairs(diagram: string): Set<string> {
    const pairs = new Set<string>();
    for (const line of diagram.split(/\r?\n/)) {
        const match = /^\s*(\[\*\]|\w+)\s*-->\s*(\[\*\]|\w+)\s*(?::|$)/.exec(line);
        if (match === null) continue;
        const from = match[1] === "[*]" ? "null" : match[1];
        const to = match[2] === "[*]" ? "null" : match[2];
        pairs.add(`${String(from)}->${String(to)}`);
    }
    return pairs;
}

function codePairs(
    edges: readonly { readonly from: string | null; readonly to: string | null }[],
): Set<string> {
    return new Set(edges.map((e) => `${String(e.from)}->${String(e.to)}`));
}

describe("src/workflow/transitions.ts tables ≡ design/contracts/taxonomy.md diagrams", () => {
    const markdown = readFileSync(DOC, "utf8");
    const diagrams = mermaidBlocks(markdown).filter((b) => b.includes("stateDiagram"));

    it("the document still contains both flow diagrams", () => {
        // A renamed or deleted diagram must fail here rather than leave the
        // comparison below running against an empty set.
        expect(diagrams).toHaveLength(2);
    });

    it.each([
        ["issue", "awaitingTriage", PROFILE_EDGES.issue],
        ["pull request", "needsReview", PROFILE_EDGES.pullRequest],
    ] as const)("the %s flow matches edge for edge", (_name, marker, edges) => {
        const diagram = diagrams.find((d) => d.includes(marker));
        expect(diagram, `no diagram mentioning ${marker}`).toBeDefined();
        if (diagram === undefined) return;

        const fromDoc = [...edgePairs(diagram)].sort();
        const fromCode = [...codePairs(edges)].sort();
        // One assertion, both directions: a missing and an extra edge are the
        // same defect seen from either side.
        expect(fromCode).toEqual(fromDoc);
    });
});
