/**
 * Every fenced Mermaid block in the tree is handed to Mermaid's own parser
 * (D182). A `;` ends a Mermaid statement, so one inside a message left §4's
 * sequence diagram unrenderable for weeks and no check noticed: a diagram
 * that cannot render is a page that lies quietly.
 *
 * The whole DOM shim is `window` and `document`; the parser reaches for no
 * other global under Node.
 */

import { describe, expect, it } from "vitest";
import { lines, markdownDocuments } from "./repository.js";

const { JSDOM } = await import("jsdom");
const { window } = new JSDOM("<!doctype html><html><body></body></html>");
Object.assign(globalThis, { window, document: window.document });
const mermaid = (await import("mermaid")).default;

/** A diagram and the line its fence opens on, which is what a reader scrolls to. */
interface Block {
    readonly doc: string;
    readonly at: number;
    readonly code: string;
}

const OPEN = /^\s*```mermaid\s*$/;
const CLOSE = /^\s*```\s*$/;

function mermaidBlocks(doc: string, text: string): Block[] {
    const source = lines(text);
    const found: Block[] = [];
    let index = 0;
    while (index < source.length) {
        if (!OPEN.test(source[index] ?? "")) {
            index += 1;
            continue;
        }
        const at = index + 1;
        const body: string[] = [];
        index += 1;
        while (index < source.length && !CLOSE.test(source[index] ?? "")) {
            body.push(source[index] ?? "");
            index += 1;
        }
        found.push({ doc, at, code: body.join("\n") });
        index += 1;
    }
    return found;
}

/** The parser's first line, which names the fault and the line inside the diagram. */
async function parseFailure(code: string): Promise<string | undefined> {
    try {
        await mermaid.parse(code);
        return undefined;
    } catch (error) {
        return String(error instanceof Error ? error.message : error).split("\n")[0];
    }
}

describe("every diagram in the tree parses", () => {
    const blocks = markdownDocuments().flatMap(({ doc, text }) => mermaidBlocks(doc, text));

    it("finds diagrams to parse", () => {
        expect(blocks.length).toBeGreaterThan(10);
    });

    it("hands every block to Mermaid and none is rejected", async () => {
        const bad: string[] = [];
        for (const { doc, at, code } of blocks) {
            const failure = await parseFailure(code);
            if (failure !== undefined) bad.push(`${doc}:${at} — ${failure}`);
        }
        expect(bad).toEqual([]);
    }, 60_000);

    it("proves the check can fail on the semicolon that hid for weeks", async () => {
        const fixture = "sequenceDiagram\n    R->>S: bytes + delivery, event; signature headers";
        expect(await parseFailure(fixture)).toMatch(/^Parse error on line 2/);
    });

    it("takes the fence's line and the body between the fences", () => {
        const doc = "prose\n\n```mermaid\nflowchart TD\n  A-->B\n```\n";
        expect(mermaidBlocks("x.md", doc)).toEqual([
            { doc: "x.md", at: 3, code: "flowchart TD\n  A-->B" },
        ]);
    });
});
