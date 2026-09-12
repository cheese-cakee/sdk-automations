/**
 * References resolve: cited paths, bare filenames in prose, and cited decision
 * rows all point at something that exists. A reference that points at nothing
 * breaks nothing and warns nobody, so only a test can see the rot.
 *
 * The corpus is every document EXCEPT the register's two files, the
 * constraints page and its history (`referenceDocuments`): a row is never
 * edited and names the tree as it was on the day it was taken.
 * One invariant per file (D89).
 *
 * A document path is checked in one more corpus: `src/` and `test/`. Moving a
 * design page into its folder left an operator-facing error string and a
 * `describe` title naming the old path, and nothing fired — a citation is a
 * citation whether a document or a module carries it.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REGISTER_HISTORY, referenceDocuments, repoRoot, sourceFiles } from "./repository.js";

describe("documents cite files that exist", () => {
    const docs = referenceDocuments();

    // Layout-independent on purpose: any packages/…/(src|test)/….ts shape is a
    // citation, and existence is the only judge. Building this from the
    // workspace file instead makes a citation of a MOVED package stop matching,
    // so it goes invisible rather than turning up dangling (D112).
    const PATH = /\b(packages\/[A-Za-z0-9._/-]+?\/(?:src|test)\/[A-Za-z0-9._/-]+\.ts)\b/g;

    // Exactly the two knowledge roots. A bare `examples/x.yml` is a
    // docs-RELATIVE link (D97) and `links.test.ts`'s job, not a repo-rooted
    // path; `docs/examples/…` still matches here.
    const DOC_PATH = /\b((?:design|docs)\/[A-Za-z0-9._/-]+\.(?:md|yml))\b/g;

    it("finds documents and citations to check", () => {
        expect(docs.length).toBeGreaterThan(5);
        const total = docs.reduce((n, d) => n + [...d.text.matchAll(PATH)].length, 0);
        expect(total).toBeGreaterThan(20);
    });

    it("every cited source path resolves to a real file", () => {
        const dangling: string[] = [];
        for (const { doc, text } of docs) {
            for (const match of text.matchAll(PATH)) {
                const cited = match[1]!;
                if (!existsSync(join(repoRoot, cited))) {
                    dangling.push(`${doc} -> ${cited}`);
                }
            }
        }
        expect(dangling).toEqual([]);
    });

    it("every cited document path resolves to a real file", () => {
        const dangling: string[] = [];
        for (const { doc, text } of docs) {
            for (const match of text.matchAll(DOC_PATH)) {
                const cited = match[1]!;
                if (!existsSync(join(repoRoot, cited))) {
                    dangling.push(`${doc} -> ${cited}`);
                }
            }
        }
        expect([...new Set(dangling)]).toEqual([]);
    });

    /**
     * The same regex, one more corpus. A design page moved into its folder
     * left an operator-facing error string and a `describe` title naming the
     * old path, and nothing fired: a citation is a citation whether a document
     * or a module carries it. Source is matched whole rather than lexed —
     * `//` inside a string and a backtick inside a comment both defeat a
     * regex lexer, and a comment naming a page that moved is the same rot.
     */
    const sources = sourceFiles().map((file) => ({
        file,
        text: readFileSync(join(repoRoot, file), "utf8"),
    }));

    it("every document path named in source resolves to a real file", () => {
        const cited = sources.flatMap(({ file, text }) =>
            [...text.matchAll(DOC_PATH)].map((match) => ({ file, path: match[1]! })),
        );
        // A corpus that matched nothing would pass this check forever.
        expect(cited.length).toBeGreaterThan(20);
        const dangling = cited
            .filter(({ path }) => !existsSync(join(repoRoot, path)))
            .map(({ file, path }) => `${file} -> ${path}`);
        expect([...new Set(dangling)]).toEqual([]);
    });

    it("proves the check can fail", () => {
        // Negative control, both directions: the matcher must find a path, and
        // the existence check must reject one that is not there.
        //
        // Every missing path here is ASSEMBLED, never written: `sourceFiles()`
        // reads this file too, so a written one would report itself against
        // the source check above — the same reason `architecture.test.ts`
        // assembles the specifier its own control needs.
        const goneDesign = ["design", "audit", "nope.md"].join("/");
        const goneDoc = ["docs", "missing.md"].join("/");
        const fake = `see \`packages/core/src/nonexistent.ts\` and \`${goneDesign}\``;
        expect([...fake.matchAll(PATH)].map((m) => m[1])).toEqual([
            "packages/core/src/nonexistent.ts",
        ]);
        expect([...fake.matchAll(DOC_PATH)].map((m) => m[1])).toEqual([goneDesign]);
        expect(existsSync(join(repoRoot, "packages/core/src/nonexistent.ts"))).toBe(false);
        expect(existsSync(join(repoRoot, goneDesign))).toBe(false);
        expect(existsSync(join(repoRoot, "packages/core/src/index.ts"))).toBe(true);
        expect(existsSync(join(repoRoot, "design/audit/services.md"))).toBe(true);

        // The diary's pair, as source rather than prose: an operator-facing
        // string and a `describe` title, both naming a page that is not there.
        const module = [
            `const advice = "see ${goneDoc} for the rule";`,
            `describe("${goneDesign}", () => {});`,
        ].join("\n");
        const named = [...module.matchAll(DOC_PATH)].map((m) => m[1]!);
        expect(named).toEqual([goneDoc, goneDesign]);
        expect(named.filter((path) => existsSync(join(repoRoot, path)))).toEqual([]);
    });

    it("still matches a package's old home after a move", () => {
        // The regression the layout-independent shape guards: a citation of a
        // path that predates a package move must stay MATCHED, so it turns up
        // dangling rather than slipping outside the pattern.
        const moved = "packages/checks/test/citations.test.ts";
        expect([...moved.matchAll(PATH)].map((m) => m[1])).toEqual([moved]);
        expect(existsSync(join(repoRoot, moved))).toBe(false);
    });
});

/**
 * The blind spot in the check above, which validates PATHS: a mermaid diagram
 * can name a deleted file as a bare label and sail through. Matching is on the
 * FILENAME and deliberately lenient — a document may mention a file without
 * siting it, and the failure worth catching is a name referring to nothing.
 */
describe("documents name files that exist", () => {
    const sourceNames = new Set(sourceFiles().map((path) => path.split("/").pop()!));

    const docs = referenceDocuments();

    // Dotted basenames are the majority of the tree — `shell.test.ts`,
    // `vitest.config.ts` — and a single-dot pattern could not match one at
    // all: its character class excluded the dot, and the lookbehind then
    // blocked the `test.ts` tail, so every spec this repository renamed was
    // invisible to the check that exists to catch renames. The class admits
    // capitals because the operation modules are camelCase
    // (`postManagedComment.ts`), and a name the pattern cannot match is a
    // name the check never resolves (D144).
    const NAME = /(?<![\w/.-])([a-zA-Z][a-zA-Z0-9-]*(?:\.[a-zA-Z0-9-]+)*\.ts)(?![\w-])/g;

    it("knows the source filenames and finds names to check", () => {
        expect(sourceNames.size).toBeGreaterThan(15);
        expect(docs.length).toBeGreaterThan(5);
    });

    it("every bare source filename in a document resolves to a real file", () => {
        const unknown: string[] = [];
        for (const { doc, text } of docs) {
            for (const match of text.matchAll(NAME)) {
                const name = match[1]!;
                if (!sourceNames.has(name)) {
                    unknown.push(`${doc} -> ${name}`);
                }
            }
        }
        expect([...new Set(unknown)]).toEqual([]);
    });

    it("proves the check can fail", () => {
        expect(sourceNames.has("write.ts")).toBe(true);
        expect(sourceNames.has("shell.test.ts")).toBe(true);
        expect(sourceNames.has("taxonomy.ts")).toBe(false);
        // The rename this branch made: the dotted name a single-dot pattern
        // could not see, so its deletion went unreported.
        expect(sourceNames.has("support.test.ts")).toBe(false);
        const prose = "see `taxonomy.ts`, `support.test.ts` and `write.ts`";
        expect([...prose.matchAll(NAME)].map((m) => m[1])).toEqual([
            "taxonomy.ts",
            "support.test.ts",
            "write.ts",
        ]);
    });

    it("leaves a name inside a path to the path check", () => {
        // Paths are the describe above's job, matched whole and judged by
        // existence; a basename lifted out of one would be reported twice.
        const cited = "packages/core/test/slice.test.ts and packages/core/src/report/convert.ts";
        expect([...cited.matchAll(NAME)]).toEqual([]);
    });
});

/**
 * A decision id is neither a path nor a filename, so the checks above cannot
 * see it: `D77` was cited three times in `core/src` before its row existed.
 *
 * Resolved against HISTORY, which holds every id ever written. The constraints
 * page holds only the binding subset, so a source comment citing a row that
 * has stopped binding still resolves.
 */
describe("code cites decisions that exist", () => {
    const register = readFileSync(join(repoRoot, REGISTER_HISTORY), "utf8");
    const recorded = new Set([...register.matchAll(/^\| (D\d+) \|/gm)].map((m) => m[1]!));

    const sources = sourceFiles(["src"]).map((file) => ({
        file,
        text: readFileSync(join(repoRoot, file), "utf8"),
    }));

    it("knows the register's rows and finds citations to check", () => {
        expect(recorded.size).toBeGreaterThan(50);
        const cited = sources.flatMap((s) => [...s.text.matchAll(/\bD\d+\b/g)]);
        expect(cited.length).toBeGreaterThan(20);
    });

    it("every decision id cited in source appears in the register", () => {
        const dangling: string[] = [];
        for (const { file, text } of sources) {
            for (const m of text.matchAll(/\bD\d+\b/g)) {
                if (!recorded.has(m[0])) dangling.push(`${file} -> ${m[0]}`);
            }
        }
        expect([...new Set(dangling)]).toEqual([]);
    });

    it("proves the check can fail", () => {
        expect(recorded.has("D77")).toBe(true);
        expect(recorded.has("D9999")).toBe(false);
    });
});
