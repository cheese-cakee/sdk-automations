/**
 * Every relative markdown link resolves (D96). `citations.test.ts` checks only
 * repo-rooted paths, and a relative link is what a directory move breaks
 * silently: the text still reads correctly and the target is gone.
 *
 * Resolution is per-file, the way a reader's click resolves it.
 */

import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { lines, markdownDocuments, normalizeRepoPath, repoRoot } from "./repository.js";

/** `[text](target)` — the target only, before any `#anchor` or title. */
const LINK = /\]\(([^)\s]+)/g;

/** Links this check cannot resolve: the web, anchors, mail. */
function isLocal(target: string): boolean {
    return (
        !/^[a-z][a-z0-9+.-]*:/i.test(target) && !target.startsWith("#") && !target.startsWith("//")
    );
}

export function danglingLinks(doc: string, text: string): string[] {
    const from = dirname(join(repoRoot, doc));
    const bad: string[] = [];
    for (const match of text.matchAll(LINK)) {
        const target = match[1]!.split("#")[0]!;
        if (target === "" || !isLocal(target)) continue;
        // A root-relative target ("/docs/x.md") resolves from the root;
        // everything else resolves from the document's own directory.
        const resolved = target.startsWith("/")
            ? join(repoRoot, target.slice(1))
            : resolve(from, target);
        if (!existsSync(resolved)) bad.push(`${doc} -> ${target}`);
    }
    return bad;
}

describe("markdown links resolve from the document that carries them", () => {
    const docs = markdownDocuments();

    it("finds documents and links to check", () => {
        expect(docs.length).toBeGreaterThan(5);
        const total = docs.reduce((n, d) => n + [...d.text.matchAll(LINK)].length, 0);
        expect(total).toBeGreaterThan(20);
    });

    it("every local link points at a file that exists", () => {
        const bad = docs.flatMap(({ doc, text }) => danglingLinks(doc, text));
        expect([...new Set(bad)]).toEqual([]);
    });

    it("proves the check can fail, and skips what it cannot resolve", () => {
        const fake = [
            "[gone](../nowhere/absent.md)",
            "[web](https://example.com/x.md)",
            "[anchor](#section)",
            "[real](repository.ts)",
        ].join(" ");
        // Resolution is from this file's own directory, so the sibling
        // resolves and the invented parent does not.
        const bad = danglingLinks("packages/dev/checks/test/links.test.ts", fake);
        expect(bad).toEqual(["packages/dev/checks/test/links.test.ts -> ../nowhere/absent.md"]);
    });

    it("normalizes the way the other repository checks do", () => {
        expect(normalizeRepoPath("a\\b.md")).toBe("a/b.md");
        expect(lines("a\r\nb")).toEqual(["a", "b"]);
    });
});
