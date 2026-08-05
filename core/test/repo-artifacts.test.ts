/**
 * Invariants about the repository as an ARTIFACT, not about behaviour.
 *
 * The same genre as `doc-drift.test.ts`, and here for the same reason: two
 * regressions in one week broke nothing a behaviour test could see.
 *
 * 1. `deriveIdempotencyKey` joined fields with a NUL byte. The keys were
 *    correct, every test passed, and `runtime.ts` became a binary file to
 *    grep and diff — in a repository where grepping `FINDING(...)` is how
 *    code and register stay tied together.
 * 2. `stryker.config.json` mutated `src/*.ts`, a single-level glob. When
 *    three modules moved into `src/github/`, they silently stopped being
 *    mutation-tested. Nothing failed; the files were simply skipped.
 *
 * Note the asymmetry the second one turns on: a mutate glob matching ZERO
 * files fails loudly, and a glob matching SOME of them passes in silence.
 * Only the second case is dangerous, and only a test can see it.
 *
 * Like `doc-drift`, these read files. `src/` stays pure — this is a
 * build-time consistency check, not a module.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Package list comes from the workspace file rather than a hard-coded array,
 * so this keeps working when `probes/` is deleted at stage four and when
 * later packages arrive. A test that needs editing to stay correct is a test
 * that quietly stops being run.
 */
function workspacePackages(): string[] {
    const yaml = readFileSync(join(repoRoot, "pnpm-workspace.yaml"), "utf8");
    return yaml
        .split("\n")
        .map((line) => /^\s*-\s*(.+?)\s*$/.exec(line)?.[1])
        .filter((name): name is string => name !== undefined);
}

function typescriptFiles(): string[] {
    const found: string[] = [];
    for (const pkg of workspacePackages()) {
        for (const dir of ["src", "test"]) {
            const root = join(repoRoot, pkg, dir);
            let entries: string[];
            try {
                entries = readdirSync(root, { recursive: true }) as string[];
            } catch {
                continue; // a package need not have both directories
            }
            found.push(
                ...entries
                    .filter((rel) => rel.endsWith(".ts"))
                    .map((rel) => join(root, rel)),
            );
        }
    }
    return found;
}

describe("source files stay readable to text tools", () => {
    const files = typescriptFiles();

    it("finds the workspace's TypeScript sources", () => {
        // Guards against the walk silently returning nothing, which would
        // make every assertion below vacuously true.
        expect(files.length).toBeGreaterThan(20);
    });

    it("contains no control characters that make a file read as binary", () => {
        // Tab, newline and carriage return only. Anything else in this range
        // makes grep report "Binary file matches" and stops diffs rendering.
        const offenders: string[] = [];
        for (const file of files) {
            const bytes = readFileSync(file);
            for (const byte of bytes) {
                if (byte > 0x1f) continue;
                if (byte === 0x09 || byte === 0x0a || byte === 0x0d) continue;
                offenders.push(`${file.replace(repoRoot, "")} (byte 0x${byte.toString(16)})`);
                break;
            }
        }
        expect(offenders).toEqual([]);
    });
});

/**
 * Minimal glob matcher — enough for the patterns Stryker configs use.
 *
 * Single pass, deliberately. The obvious implementation is a chain of
 * `.replace()` calls, and it is wrong: expanding `**​/` inserts `(?:…/)*`
 * into the string, and the *next* replacement then rewrites the `*` and `?`
 * of the token just emitted. The first draft here did exactly that and
 * produced a regex matching nothing at all.
 */
function globToRegExp(glob: string): RegExp {
    let body = "";
    for (let i = 0; i < glob.length; i++) {
        const char = glob[i]!;
        if (char === "*") {
            if (glob[i + 1] === "*") {
                if (glob[i + 2] === "/") {
                    body += "(?:[^/]+/)*"; // any number of directories
                    i += 2;
                } else {
                    body += ".*";
                    i += 1;
                }
            } else {
                body += "[^/]*"; // one segment only
            }
        } else if (char === "?") {
            body += "[^/]";
        } else {
            body += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
        }
    }
    return new RegExp(`^${body}$`);
}

describe("mutation testing covers every core module", () => {
    const config = JSON.parse(
        readFileSync(join(repoRoot, "core", "stryker.config.json"), "utf8"),
    ) as { mutate: string[]; thresholds: { break: number | null } };

    const patterns = config.mutate.map(globToRegExp);
    const srcRoot = join(repoRoot, "core", "src");
    const modules = (readdirSync(srcRoot, { recursive: true }) as string[])
        .filter((rel) => rel.endsWith(".ts"))
        .map((rel) => `src/${rel.split("\\").join("/")}`);

    it("finds the core modules", () => {
        expect(modules.length).toBeGreaterThan(5);
        // The move that caused the regression: a nested module must exist,
        // or this test cannot detect a single-level glob at all.
        expect(modules).toContain("src/github/failures.ts");
    });

    it("matches every module against the mutate globs", () => {
        const unmatched = modules.filter(
            (module) => !patterns.some((pattern) => pattern.test(module)),
        );
        expect(unmatched).toEqual([]);
    });

    /**
     * Negative control, in both directions. The first draft asserted only
     * that a single-level glob REJECTS a nested path — and passed while the
     * matcher was so broken it rejected everything, including the paths it
     * was supposed to accept. A control that can only observe rejection
     * cannot tell "correctly strict" from "entirely broken".
     */
    it("proves the matcher can both accept and reject", () => {
        const singleLevel = globToRegExp("src/*.ts");
        expect(singleLevel.test("src/config.ts")).toBe(true);
        expect(singleLevel.test("src/github/failures.ts")).toBe(false);

        const recursive = globToRegExp("src/**/*.ts");
        expect(recursive.test("src/config.ts")).toBe(true);
        expect(recursive.test("src/github/failures.ts")).toBe(true);
        expect(recursive.test("src/github/deep/nested.ts")).toBe(true);
        expect(recursive.test("test/config.test.ts")).toBe(false);
    });

    /**
     * D40's sibling question, answered in config rather than convention: a
     * `break` of `null` means the mutation score can never fail anything, so
     * a module could drop to zero in CI and pass. It has to be a number.
     */
    it("sets a break threshold, so the score can fail a build", () => {
        expect(typeof config.thresholds.break).toBe("number");
    });
});

/**
 * The fifth sighting of "one fact, two places" (D76) was `REPOSITORY_MODES`
 * as a const array beside a hand-written `RepositoryMode` union in another
 * file — four strings duplicated, with a cast covering the seam. It was found
 * by reading, which is not a method that scales. This finds the next one.
 */
describe("enumerations are declared once", () => {
    const sources = (readdirSync(join(repoRoot, "core", "src"), {
        recursive: true,
    }) as string[])
        .filter((rel) => rel.endsWith(".ts"))
        .map((rel) => ({
            file: `src/${rel.split("\\").join("/")}`,
            text: readFileSync(join(repoRoot, "core", "src", rel), "utf8"),
        }));

    it("finds the core sources", () => {
        expect(sources.length).toBeGreaterThan(5);
    });

    it("every exported const array has a union derived from it", () => {
        const orphans: string[] = [];
        for (const { file, text } of sources) {
            for (const match of text.matchAll(/export const ([A-Z][A-Z0-9_]*) = \[/g)) {
                const name = match[1]!;
                // The union must be derived, in the same file, from this array.
                if (!text.includes(`(typeof ${name})[number]`)) {
                    orphans.push(`${file}: ${name}`);
                }
            }
        }
        expect(orphans).toEqual([]);
    });

    it("proves the check can fail", () => {
        // Negative control: the detector must reject a const array with no
        // derived union, or the assertion above means nothing.
        const fake = 'export const COLOURS = ["red", "blue"] as const;';
        const found = [...fake.matchAll(/export const ([A-Z][A-Z0-9_]*) = \[/g)];
        expect(found).toHaveLength(1);
        expect(fake.includes("(typeof COLOURS)[number]")).toBe(false);
    });
});

/**
 * A citation that points at a file which no longer exists breaks nothing.
 * No test fails, no build breaks, no reader is warned — the reference simply
 * becomes a lie, and the register's whole method is that a row cites the code
 * proving it. Fifty-one such citations exist today, and the directory
 * reorganisation is about to move most of the files they name.
 *
 * Same class as the mutate glob: silent when wrong, so it needs a test rather
 * than care.
 */
describe("documents cite files that exist", () => {
    const docs = (readdirSync(repoRoot, { recursive: true }) as string[])
        .filter(
            (rel) =>
                rel.endsWith(".md") &&
                !rel.includes("node_modules") &&
                !rel.includes(".stryker-tmp") &&
                // `experiments/` is untracked by design (see its README), so
                // it exists on some machines and not in CI. Scanning it would
                // make this suite pass or fail by geography.
                !rel.startsWith("experiments/"),
        )
        .map((rel) => ({ doc: rel, text: readFileSync(join(repoRoot, rel), "utf8") }));

    const PATH = /\b((?:core|store|executor|probes)\/(?:src|test)\/[A-Za-z0-9._/-]+\.ts)\b/g;

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

    it("proves the check can fail", () => {
        // Negative control, both directions: the matcher must find a path and
        // the existence check must reject one that is not there.
        const fake = "see `core/src/nonexistent.ts` for details";
        const found = [...fake.matchAll(PATH)].map((m) => m[1]);
        expect(found).toEqual(["core/src/nonexistent.ts"]);
        expect(existsSync(join(repoRoot, found[0]!))).toBe(false);
        expect(existsSync(join(repoRoot, "core/src/index.ts"))).toBe(true);
    });
});

/**
 * The blind spot in the check above, found the hard way: it validates
 * `core/src/….ts` PATHS, and the architecture diagram in `core/README.md`
 * named six files as bare mermaid labels — `taxonomy.ts`, `config.ts` and
 * the rest. The directory reorganisation deleted every one of them and the
 * diagram sailed through, still describing a package that no longer existed.
 *
 * Diagrams are where a visual reader looks first, so a stale one misleads
 * more than a stale sentence. This matches on the FILENAME rather than the
 * path — deliberately lenient, because a document may reasonably mention a
 * file without siting it, and the failure worth catching is a name that
 * refers to nothing at all.
 */
describe("documents name files that exist", () => {
    const sourceNames = new Set<string>();
    for (const pkg of ["core", "store", "executor", "probes"]) {
        for (const dir of ["src", "test"]) {
            try {
                for (const rel of readdirSync(join(repoRoot, pkg, dir), {
                    recursive: true,
                }) as string[]) {
                    if (rel.endsWith(".ts")) sourceNames.add(rel.split("/").pop()!);
                }
            } catch {
                // a package need not have both directories
            }
        }
    }

    const docs = (readdirSync(repoRoot, { recursive: true }) as string[]).filter(
        (rel) =>
            rel.endsWith(".md") &&
            !rel.includes("node_modules") &&
            !rel.includes(".stryker-tmp") &&
            !rel.startsWith("experiments/"),
    );

    const NAME = /(?<![\w/.-])([a-z][a-z0-9-]*\.ts)(?![\w-])/g;

    /**
     * Files a document names DELIBERATELY before they exist — `github/`'s
     * README lists what the adapter will bring. The list cleans itself up:
     * the test below fails if an entry starts existing, so a planned file
     * arriving forces the exemption to be deleted rather than lingering as
     * a permanent hole in the check.
     */
    const PLANNED = new Set(["endpoints.ts", "permissions.ts", "events.ts"]);

    it("no planned filename has quietly started existing", () => {
        const arrived = [...PLANNED].filter((name) => sourceNames.has(name));
        expect(arrived).toEqual([]);
    });

    it("knows the source filenames and finds names to check", () => {
        expect(sourceNames.size).toBeGreaterThan(15);
        expect(docs.length).toBeGreaterThan(5);
    });

    it("every bare source filename in a document resolves to a real file", () => {
        const unknown: string[] = [];
        for (const doc of docs) {
            const text = readFileSync(join(repoRoot, doc), "utf8");
            for (const match of text.matchAll(NAME)) {
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
        expect(sourceNames.has("taxonomy.ts")).toBe(false);
        expect([..."see `taxonomy.ts` and `write.ts`".matchAll(NAME)].map((m) => m[1]))
            .toEqual(["taxonomy.ts", "write.ts"]);
    });
});
