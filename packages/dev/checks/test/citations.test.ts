/**
 * References resolve: cited paths, bare filenames in prose, and cited decision
 * rows all point at something that exists. A reference that points at nothing
 * breaks nothing and warns nobody, while the register's method is that a row
 * cites the code proving it — so only a test can see the rot.
 * One invariant per file (D89).
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { markdownDocuments, repoRoot, sourceFiles } from "./repository.js";

describe("documents cite files that exist", () => {
    const docs = markdownDocuments();

    // Layout-independent on purpose: any packages/…/(src|test)/….ts shape is a
    // citation, and existence is the only judge. Building this from the
    // workspace file instead makes a citation of a MOVED package stop matching,
    // so it goes invisible rather than turning up dangling (D112).
    const PATH = /\b(packages\/[A-Za-z0-9._/-]+?\/(?:src|test)\/[A-Za-z0-9._/-]+\.ts)\b/g;

    // Exactly the two knowledge roots. A bare `examples/x.yml` is a
    // docs-RELATIVE link (D97) and `links.test.ts`'s job, not a repo-rooted
    // path; `docs/examples/…` still matches here.
    const DOC_PATH = /\b((?:design|docs)\/[A-Za-z0-9._/-]+\.(?:md|yml))\b/g;

    /**
     * Paths the register cites DELIBERATELY before they exist: the executor is
     * designed, not built. Self-cleaning — the arrival test fails the day one
     * of these lands, so an entry cannot outlive its future.
     */
    const PLANNED_PATHS = new Set([
        "packages/executor/src/planner.ts",
        "packages/executor/src/policy.ts",
        "packages/executor/src/recovery.ts",
    ]);

    it("no planned path has quietly started existing", () => {
        const arrived = [...PLANNED_PATHS].filter((path) => existsSync(join(repoRoot, path)));
        expect(arrived).toEqual([]);
    });

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
                if (!PLANNED_PATHS.has(cited) && !existsSync(join(repoRoot, cited))) {
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

    it("proves the check can fail", () => {
        // Negative control, both directions: the matcher must find a path, and
        // the existence check must reject one that is not there.
        const fake = "see `packages/core/src/nonexistent.ts` and `design/audit/nope.md`";
        expect([...fake.matchAll(PATH)].map((m) => m[1])).toEqual([
            "packages/core/src/nonexistent.ts",
        ]);
        expect([...fake.matchAll(DOC_PATH)].map((m) => m[1])).toEqual(["design/audit/nope.md"]);
        expect(existsSync(join(repoRoot, "packages/core/src/nonexistent.ts"))).toBe(false);
        expect(existsSync(join(repoRoot, "design/audit/nope.md"))).toBe(false);
        expect(existsSync(join(repoRoot, "packages/core/src/index.ts"))).toBe(true);
        expect(existsSync(join(repoRoot, "design/audit/services.md"))).toBe(true);
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

    const docs = markdownDocuments();

    // Dotted basenames are the majority of the tree — `shell.test.ts`,
    // `vitest.config.ts` — and a single-dot pattern could not match one at
    // all: its character class excluded the dot, and the lookbehind then
    // blocked the `test.ts` tail, so every spec this repository renamed was
    // invisible to the check that exists to catch renames.
    const NAME = /(?<![\w/.-])([a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*\.ts)(?![\w-])/g;

    /**
     * Files a document names DELIBERATELY before they exist, such as what
     * `github/`'s README says the adapter will bring. Self-cleaning: the test
     * below fails once an entry exists, so the exemption must be deleted
     * rather than linger as a permanent hole in the check.
     */
    const PLANNED = new Set(["endpoints.ts", "subscriptions.ts"]);

    it("no planned filename has quietly started existing", () => {
        const arrived = [...PLANNED].filter((name) => sourceNames.has(name));
        expect(arrived).toEqual([]);
    });

    it("knows the source filenames and finds names to check", () => {
        expect(sourceNames.size).toBeGreaterThan(15);
        expect(docs.length).toBeGreaterThan(5);
    });

    /**
     * Register rows that NARRATE a rename, split or deletion: each names the
     * file as it was CALLED when the decision was taken — `lab.test.ts` became
     * `never-tracked.test.ts` and the sentence saying so cannot be rewritten —
     * and the register is immutable. Excised row by row rather than by name,
     * so a stale mention of the same file anywhere else still fails, and
     * active documentation stays checked throughout.
     */
    const HISTORIC_ROWS = ["D75", "D85", "D87", "D99", "D108"];
    const HISTORIC = new RegExp(`^\\| (?:${HISTORIC_ROWS.join("|")}) \\|.*$`, "gm");

    it("every excised row is still a row of the register", () => {
        const register = readFileSync(join(repoRoot, "design", "decisions.md"), "utf8");
        const excised = [...register.matchAll(HISTORIC)].length;
        expect(excised).toBe(HISTORIC_ROWS.length);
    });

    it("every bare source filename in a document resolves to a real file", () => {
        const unknown: string[] = [];
        for (const { doc, text } of docs) {
            const activeText = doc === "design/decisions.md" ? text.replace(HISTORIC, "") : text;
            for (const match of activeText.matchAll(NAME)) {
                const name = match[1]!;
                if (!sourceNames.has(name) && !PLANNED.has(name)) {
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
 */
describe("code cites decisions that exist", () => {
    const register = readFileSync(join(repoRoot, "design", "decisions.md"), "utf8");
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
