/**
 * The shipped `docs/examples/` files still parse, through the entry point the
 * shell uses (D82). A documented example that stopped parsing would surface
 * only as a maintainer's confusion.
 *
 * A repository check, not coverage: Stryker's sandbox is `core/`, so nothing
 * here can kill a mutant and the rejection corpus lives in core (D82, D85).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseConfigDocument } from "@hiero-hackers/automation-core";
import { docsDir, exampleFiles } from "./repository.js";

const examplesDir = join(docsDir, "examples");

/** The direct capability list these schema examples are read against. */
const KNOWN = ["assignment", "intake", "prQuality"];

const parse = (file: string) =>
    parseConfigDocument(readFileSync(join(examplesDir, file), "utf8"), {
        revision: file,
        knownCapabilities: KNOWN,
    });

const files = exampleFiles();

describe("the shipped examples", () => {
    /** A directory read that finds nothing passes every loop below in silence. */
    it("finds the examples at all", () => {
        expect(files.sort()).toEqual([
            "active.yml",
            "empty.yml",
            "minimal.yml",
            "observe-only.yml",
        ]);
    });

    it.each(files)("%s parses", (file) => {
        const result = parse(file);
        expect(result.ok ? [] : result.errors.map((e) => `${e.code} @ ${e.path}`)).toEqual([]);
    });

    it("the file with nothing in it is a repository in observe", () => {
        const empty = parse("empty.yml");
        expect(empty.ok && empty.config.mode).toBe("observe");
    });

    it("retains active in Core's configuration vocabulary", () => {
        const observe = parse("observe-only.yml");
        const active = parse("active.yml");
        expect(observe.ok && active.ok).toBe(true);
        if (!observe.ok || !active.ok) return;

        expect(observe.config.mode).toBe("observe");
        expect(active.config.mode).toBe("active");
        for (const [meaning, label] of Object.entries(observe.config.mappings.labels)) {
            expect(active.config.mappings.labels).toHaveProperty(meaning, label);
        }
    });

    it("a known capability may be configured while disabled", () => {
        const active = parse("active.yml");
        expect(active.ok).toBe(true);
        if (!active.ok) return;
        expect(active.config.capabilities.assignment).toMatchObject({ enabled: false });
    });

    /** A file with no README row is one nobody will read; a row with no file is a promise. */
    it("every example is described in the README", () => {
        const readme = readFileSync(join(examplesDir, "README.md"), "utf8");
        for (const file of files) expect(readme).toContain(`\`${file}\``);
    });
});
