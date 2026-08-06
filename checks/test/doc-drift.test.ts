/**
 * The drift detector `core/README.md` promised and did not have.
 *
 * The transition tables in `src/taxonomy.ts` are hand copies of the state
 * diagrams in `design/core/taxonomy.md`; nothing generated one from the
 * other, so nothing failed when they diverged. They HAVE diverged before
 * — D48's missing `readyToMerge → needsRevision` edge was absent from
 * both, and the register's D8 row cited five conflict classes the design
 * document no longer contained (caught 2026-07-25).
 *
 * This test closes the structural half of that gap: every edge in the code
 * appears in the diagram and every diagram edge appears in the code. It
 * deliberately compares only (from, to) PAIRS, not the prose on each
 * arrow — the diagram is written for humans and the causes are checked
 * exhaustively in `taxonomy.test.ts`. A cause added to a table without a
 * doc edit still slips through; a whole edge no longer can.
 *
 * This is the only test in the package that reads a file. `src/` stays
 * pure — the I/O is the build-time consistency check, not the module.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { PROFILE_EDGES } from "@hiero-hackers/automation-core";

const DOC = new URL("../../design/core/taxonomy.md", import.meta.url);

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

describe("src/taxonomy.ts tables ≡ design/core/taxonomy.md diagrams", () => {
    const markdown = readFileSync(DOC, "utf8");
    const diagrams = mermaidBlocks(markdown).filter((b) => b.includes("stateDiagram"));

    it("the document still contains both flow diagrams", () => {
        // If a diagram is renamed away or deleted, fail loudly here
        // rather than silently comparing against an empty set.
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
        // One assertion, both directions: a missing edge and an extra
        // edge are the same defect seen from either side.
        expect(fromCode).toEqual(fromDoc);
    });
});
