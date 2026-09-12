/** The tree is bare bones: the ceilings the `docstrings` skill states, enforced. One invariant per `it` (D89). */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lines, REGISTER_HISTORY, repoRoot, repositoryFiles, sourceFiles } from "./repository.js";

const HEADER_LINES = 6;
const DECLARATION_LINES = 3;
const FIELD_LINES = 1;
const COMMENT_SHARE = 0.25;
/** A file may always carry this many comment lines, whatever its size: a header. */
const SHARE_FLOOR_LINES = 6;
const REGISTER_WORDS = 100;

/** The first register row the hundred-word rule reaches; earlier rows are never edited. */
const FIRST_ENFORCED_ROW = 147;

const DESIGN_SECTIONS = [
    "What the output looks like",
    "What the config looks like",
    "How it works",
    "Verified by",
];

const NARRATIVE = [
    /\bused to\b/i,
    /\bthe study\b/i,
    /\bbefore this\b/i,
    /\bafter this\b/i,
    /\bpacket\b/i,
    /\bsession\b/i,
    /\b(?:19|20)\d{2}\b/,
];

/** The corpus: every package source file this branch touched. */
function sourceTree(): string[] {
    return sourceFiles(["src"]);
}

function read(path: string): string {
    return readFileSync(join(repoRoot, path), "utf8");
}

function words(text: string): number {
    return text.split(/\s+/).filter(Boolean).length;
}

/** A comment block, with the delimiters stripped and the blank `*` lines dropped. */
interface Comment {
    readonly kind: "header" | "declaration" | "field";
    readonly at: number;
    readonly text: readonly string[];
}

const DECLARATION_START =
    /^(?:export|import|declare|abstract|async|function|const|let|var|class|interface|type|enum|namespace)\b/;

/** A property of an interface, a type literal or an object literal. */
const PROPERTY = /^(?:readonly\s+)?(?:\[[^\]]+\]|"[^"]+"|'[^']+'|[A-Za-z_$][\w$]*)\??\s*(?::|,$|$)/;

function bodyOf(line: string, opening: boolean): string {
    return line
        .trim()
        .replace(/\*+\/\s*$/, "")
        .replace(opening ? /^\/\*+/ : /^\*+/, "")
        .replace(/^\*+/, "")
        .replace(/^\/$/, "")
        .trim();
}

function closesOn(line: string, opening: boolean): boolean {
    const trimmed = line.trim();
    return opening ? trimmed.slice(2).includes("*/") : trimmed.includes("*/");
}

/**
 * Every comment in a file, classified: the header is the first block above any
 * import, a comment immediately above an indented property is a field comment,
 * and everything else is a declaration docstring.
 */
function comments(text: string): Comment[] {
    const source = lines(text);
    const found: Comment[] = [];
    let code = false;
    let index = 0;

    const kindAfter = (end: number): "declaration" | "field" => {
        for (let next = end + 1; next < source.length; next += 1) {
            const line = source[next] ?? "";
            const trimmed = line.trim();
            if (trimmed === "" || trimmed.startsWith("//") || trimmed.startsWith("/*")) continue;
            const nested = line.startsWith(" ") || line.startsWith("\t");
            const property = !DECLARATION_START.test(trimmed) && PROPERTY.test(trimmed);
            return nested && property ? "field" : "declaration";
        }
        return "declaration";
    };

    while (index < source.length) {
        const trimmed = (source[index] ?? "").trim();
        if (trimmed === "") {
            index += 1;
            continue;
        }
        if (trimmed.startsWith("//")) {
            const start = index;
            const run: string[] = [];
            while (index < source.length && (source[index] ?? "").trim().startsWith("//")) {
                run.push((source[index] ?? "").trim().replace(/^\/+/, "").trim());
                index += 1;
            }
            found.push({ kind: kindAfter(index - 1), at: start + 1, text: run.filter(Boolean) });
            continue;
        }
        if (!trimmed.startsWith("/*")) {
            code = true;
            index += 1;
            continue;
        }
        const start = index;
        const text_: string[] = [];
        while (index < source.length) {
            const line = source[index] ?? "";
            const body = bodyOf(line, index === start);
            if (body !== "") text_.push(body);
            const done = closesOn(line, index === start);
            index += 1;
            if (done) break;
        }
        const kind = code || found.length > 0 ? kindAfter(index - 1) : "header";
        found.push({ kind, at: start + 1, text: text_ });
    }
    return found;
}

/** The ceiling each kind of comment answers to. */
const CEILING: Readonly<Record<Comment["kind"], number>> = {
    header: HEADER_LINES,
    declaration: DECLARATION_LINES,
    field: FIELD_LINES,
};

function overlongComments(text: string, kind: Comment["kind"]): string[] {
    return comments(text)
        .filter((comment) => comment.kind === kind && comment.text.length > CEILING[kind])
        .map((comment) => `line ${comment.at}: ${comment.text.length} lines`);
}

/** Comment and non-blank line counts, delimiters counted. */
function commentCount(text: string): { readonly comment: number; readonly nonBlank: number } {
    const source = lines(text);
    let block = false;
    let comment = 0;
    let nonBlank = 0;
    for (const line of source) {
        const trimmed = line.trim();
        if (trimmed === "") continue;
        nonBlank += 1;
        if (block) {
            comment += 1;
            if (trimmed.includes("*/")) block = false;
            continue;
        }
        if (trimmed.startsWith("//")) {
            comment += 1;
            continue;
        }
        if (trimmed.startsWith("/*")) {
            comment += 1;
            if (!closesOn(trimmed, true)) block = true;
        }
    }
    return { comment, nonBlank };
}

/** Over the share, and over the floor that lets a small file keep its header. */
function overShare(text: string): boolean {
    const { comment, nonBlank } = commentCount(text);
    return comment > Math.max(SHARE_FLOOR_LINES, COMMENT_SHARE * nonBlank);
}

/** A lab run id, `2026-07-23T19-36-29-346Z#13` — evidence, not history. */
const RUN_ID = /\d{4}-\d{2}-\d{2}T[\d.-]+Z(?:#[^\s`)]+)?/g;

/** History is git's: the words a comment may not say, and any four-digit year outside a run id. */
function narrative(text: string): string[] {
    return comments(text).flatMap((comment) =>
        comment.text
            .filter((line) => NARRATIVE.some((pattern) => pattern.test(line.replace(RUN_ID, ""))))
            .map((line) => `line ${comment.at}: ${line}`),
    );
}

/** The rows the hundred-word rule reaches, with their word counts. */
function registerRows(text: string): (readonly [string, number])[] {
    return lines(text)
        .map((line) => ({ line, id: /^\| D(\d+) \|/.exec(line) }))
        .filter(({ id }) => id !== null && Number(id[1]) >= FIRST_ENFORCED_ROW)
        .map(({ line, id }) => [`D${id?.[1] ?? ""}`, words(line)] as const);
}

/** Every capability design page: the six candidates and the four beside their code. */
function designPages(): string[] {
    return repositoryFiles().filter(
        (path) =>
            (path.startsWith("design/guides/capabilities/") &&
                path.endsWith(".md") &&
                !path.endsWith("README.md")) ||
            /^packages\/capabilities\/src\/[^/]+\/design\.md$/.test(path),
    );
}

function sectionsOf(text: string): string[] {
    return lines(text)
        .filter((line) => line.startsWith("## "))
        .map((line) => line.slice(3).trim());
}

const FIXTURES = {
    header: `/**
 * One.
 * Two.
 * Three.
 * Four.
 * Five.
 * Six.
 * Seven.
 */
export const A = 1;
`,
    declaration: `/** The header. */

/**
 * One.
 * Two.
 * Three.
 * Four.
 */
export const A = 1;
`,
    field: `/** The header. */

export interface A {
    /**
     * One.
     * Two.
     */
    readonly b: string;
}
`,
    inline: `/** The header. */

// One.
// Two.
// Three.
// Four.
export const A = 1;
`,
    fieldRun: `/** The header. */

export interface A {
    // One.
    // Two.
    readonly b: string;
}
`,
    share: `/** The header. */

/** What A0 is. */
/** And more about A0. */
export const A0 = 0;

/** What A1 is. */
/** And more about A1. */
export const A1 = 1;

/** What A2 is. */
/** And more about A2. */
export const A2 = 2;

/** What A3 is. */
/** And more about A3. */
export const A3 = 3;
`,
    small: `/** The header. */
export const A = 1;
`,
    narrative: `/** The header. */

/** A used to be a string. */
export const A = 1;
`,
    year: `/** The header. */

/** Confirmed on 2026-09-12. */
export const A = 1;
`,
};

describe("a file header says what the file is and stops", () => {
    const files = sourceTree();

    it("finds the source files this branch changed", () => {
        expect(files.length).toBeGreaterThan(20);
    });

    it("holds every header to six lines", () => {
        const over = files.flatMap((file) =>
            overlongComments(read(file), "header").map((where) => `${file} ${where}`),
        );
        expect(over).toEqual([]);
    });

    it("catches a seven-line header", () => {
        expect(overlongComments(FIXTURES.header, "header")).not.toEqual([]);
    });
});

describe("a declaration docstring says what it does and one constraint", () => {
    it("holds every declaration docstring to three lines", () => {
        const over = sourceTree().flatMap((file) =>
            overlongComments(read(file), "declaration").map((where) => `${file} ${where}`),
        );
        expect(over).toEqual([]);
    });

    it("catches a four-line declaration docstring", () => {
        expect(overlongComments(FIXTURES.declaration, "declaration")).not.toEqual([]);
    });

    it("catches a four-line run of inline comments", () => {
        expect(overlongComments(FIXTURES.inline, "declaration")).not.toEqual([]);
    });
});

describe("a field comment is one line", () => {
    it("holds every one to a line", () => {
        const over = sourceTree().flatMap((file) =>
            overlongComments(read(file), "field").map((where) => `${file} ${where}`),
        );
        expect(over).toEqual([]);
    });

    it("catches a two-line field docstring", () => {
        expect(overlongComments(FIXTURES.field, "field")).not.toEqual([]);
    });

    it("catches a two-line field comment written with slashes", () => {
        expect(overlongComments(FIXTURES.fieldRun, "field")).not.toEqual([]);
    });
});

describe("a source file is a quarter comment at most", () => {
    it("holds every file under the share", () => {
        const over = sourceTree()
            .filter((file) => overShare(read(file)))
            .map((file) => {
                const { comment, nonBlank } = commentCount(read(file));
                return `${file} ${String(comment)}/${String(nonBlank)}`;
            });
        expect(over).toEqual([]);
    });

    it("catches a file that is mostly comment", () => {
        expect(overShare(FIXTURES.share)).toBe(true);
        expect(overShare(FIXTURES.small)).toBe(false);
    });
});

describe("no comment narrates history", () => {
    it("finds no narrative word in a changed source file", () => {
        const found = sourceTree().flatMap((file) =>
            narrative(read(file)).map((where) => `${file} ${where}`),
        );
        expect(found).toEqual([]);
    });

    it("catches a comment saying what something used to be", () => {
        expect(narrative(FIXTURES.narrative)).not.toEqual([]);
    });

    it("catches a dated comment", () => {
        expect(narrative(FIXTURES.year)).not.toEqual([]);
    });
});

describe("a register row is a hundred words", () => {
    const rows = registerRows(read(REGISTER_HISTORY));

    it("finds the rows the rule reaches", () => {
        expect(rows.length).toBeGreaterThan(5);
    });

    it("holds every one of them to the count", () => {
        expect(rows.filter(([, count]) => count > REGISTER_WORDS)).toEqual([]);
    });

    it("catches a row over the count", () => {
        const row = `| D147 | ${"word ".repeat(120)}| \`supported\` | Nothing. |`;
        expect(registerRows(row)).toEqual([["D147", expect.any(Number)]]);
        expect(registerRows(row)[0]?.[1]).toBeGreaterThan(REGISTER_WORDS);
    });
});

describe("a design page is four sections", () => {
    const pages = designPages();

    it("finds every design page", () => {
        expect(pages.length).toBe(10);
    });

    it("holds each page to the section list, in order", () => {
        const wrong = pages
            .map((page) => [page, sectionsOf(read(page))] as const)
            .filter(([, sections]) => sections.join(" | ") !== DESIGN_SECTIONS.join(" | "))
            .map(([page, sections]) => `${page}: ${sections.join(" | ")}`);
        expect(wrong).toEqual([]);
    });

    it("catches a page with a section of its own", () => {
        const page = ["# a — b", "## What the output looks like", "## The pillar catalogue"].join(
            "\n",
        );
        expect(sectionsOf(page)).not.toEqual(DESIGN_SECTIONS);
    });

    it("carries no not-built banner and no checked-against line", () => {
        const banners = pages
            .map((page) => [page, read(page)] as const)
            .filter(([, text]) => /Not built yet|Checked against/.test(text))
            .map(([page]) => page);
        expect(banners).toEqual([]);
    });

    it("catches a banner", () => {
        expect(/Not built yet|Checked against/.test("> **Not built yet:** the two writes.")).toBe(
            true,
        );
    });
});
