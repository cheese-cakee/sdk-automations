/**
 * The shipped `docs/examples/` files still parse, through the entry point the
 * shell uses (D82) and against the capability list the shell actually admits.
 * A documented example that stopped parsing — or that names a capability
 * nobody ships — would surface only as a maintainer's confusion.
 *
 * A repository check, not coverage: Stryker's sandbox is `core/`, so nothing
 * here can kill a mutant and the rejection corpus lives in core (D82, D85).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    MAPPING_SECTION_KEYS,
    parseConfigDocument,
    type AdmittedCapability,
} from "@hiero-hackers/automation-core";
import { declaredCapabilityNames, shippedCapabilities } from "./capabilities.js";
import { docsDir, exampleFiles, normalizeNewlines } from "./repository.js";

const examplesDir = join(docsDir, "examples");

/**
 * The declarations the parser judges a document against: name, the settings
 * keys each declares, and the mappings it requires (D84). Read off the
 * shipped list (`capabilities.ts`), so an example that configures a
 * capability the shell does not ship fails here rather than in a
 * maintainer's repository.
 */
const KNOWN: AdmittedCapability[] = shippedCapabilities()
    .map(({ name, configKeys, requiredMappings }) => ({ name, configKeys, requiredMappings }))
    .sort((a, b) => a.name.localeCompare(b.name));

const parseText = (text: string, revision: string) =>
    parseConfigDocument(text, { revision, knownCapabilities: KNOWN });

const parse = (file: string) => parseText(readFileSync(join(examplesDir, file), "utf8"), file);

const files = exampleFiles();

describe("the shipped examples", () => {
    /** A directory read that finds nothing passes every loop below in silence. */
    it("finds the examples at all", () => {
        expect(files.sort()).toEqual([
            "active.yml",
            "empty.yml",
            "full.yml",
            "inactivity.yml",
            "minimal.yml",
            "observe-only.yml",
        ]);
    });

    /** A derivation that finds nothing admits nothing, and silently. */
    it("reads the admitted capability list off the shipped capabilities", () => {
        expect(KNOWN.length).toBeGreaterThan(0);
        expect(KNOWN.map(({ name }) => name)).toEqual(declaredCapabilityNames());
    });

    /**
     * The declarations are read out of source text, so an expression that
     * matched nothing would admit every capability with no settings keys and
     * no required mappings — and every check below would pass in silence.
     * `intake` is the capability that has both, so it is the one worth pinning.
     */
    it("reads each capability's declared settings keys and required mappings", () => {
        expect(KNOWN.find(({ name }) => name === "intake")).toEqual({
            name: "intake",
            configKeys: ["announce"],
            requiredMappings: { labels: ["awaitingTriage"] },
        });
    });

    /**
     * The negative control for the list above: a name outside it is refused,
     * so a future example that configures an unshipped capability fails here
     * rather than in a maintainer's repository.
     *
     * The name has to be one NO capability will ever have (D8). This control
     * named `assignment` — a real design, unshipped on the day it was written —
     * and shipping that capability would have broken the test proving unknown
     * names are refused, which is a negative control that expires the moment it
     * matters.
     */
    it("refuses a capability the shell does not ship", () => {
        const invented = parseText(
            "schemaVersion: 1\ncapabilities:\n  neverShipped:\n    enabled: false\n",
            "invented",
        );
        expect(invented.ok ? [] : invented.errors.map((e) => e.code)).toEqual([
            "capabilityUnknown",
        ]);
    });

    /**
     * The negative controls for the two rules D84 added. Without them an
     * example could quietly stop exercising either — `observe-only.yml`
     * enables `intake`, so dropping its `awaitingTriage` line is a one-word
     * edit away from a documented file the real shell refuses to parse.
     */
    it("refuses an enabled capability missing a meaning it requires", () => {
        const unmapped = parseText(
            "schemaVersion: 1\ncapabilities:\n  intake:\n    enabled: true\n",
            "unmapped",
        );
        expect(unmapped.ok ? [] : unmapped.errors.map((e) => `${e.code} @ ${e.path}`)).toEqual([
            "meaningRequired @ mappings.labels.awaitingTriage",
        ]);
    });

    it("refuses a settings key no capability declares", () => {
        const typo = parseText(
            "schemaVersion: 1\ncapabilities:\n  intake:\n    enabled: false\n    settings:\n      annouce: true\n",
            "typo",
        );
        expect(typo.ok ? [] : typo.errors.map((e) => `${e.code} @ ${e.path}`)).toEqual([
            "unknownKey @ capabilities.intake.settings.annouce",
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

    it("a shipped capability may be configured while disabled", () => {
        const active = parse("active.yml");
        expect(active.ok).toBe(true);
        if (!active.ok) return;
        expect(active.config.capabilities.inactivity).toMatchObject({ enabled: false });
    });

    /**
     * The one example that shows everything: every shipped capability switched
     * on, every mapping family filled. A capability the registry gains and
     * this file does not is a capability the documentation never shows
     * configured — and the file's own comment claims completeness.
     */
    it("full.yml enables every shipped capability and fills every mapping family", () => {
        const full = parse("full.yml");
        expect(full.ok).toBe(true);
        if (!full.ok) return;
        const enabled = Object.entries(full.config.capabilities)
            .filter(([, block]) => block.enabled)
            .map(([name]) => name)
            .sort();
        expect(enabled).toEqual(KNOWN.map(({ name }) => name));
        for (const family of MAPPING_SECTION_KEYS) {
            expect(Object.keys(full.config.mappings[family]), family).not.toEqual([]);
        }
        expect(Object.keys(full.config.principals)).not.toEqual([]);
    });

    /** The schedule-driven example enables the one capability with no webhook. */
    it("inactivity.yml enables only the scheduled capability", () => {
        const scheduled = shippedCapabilities()
            .filter(({ triggers }) => triggers.every((t) => t.kind === "schedule"))
            .map(({ name }) => name);
        const example = parse("inactivity.yml");
        expect(example.ok).toBe(true);
        if (!example.ok) return;
        const enabled = Object.entries(example.config.capabilities)
            .filter(([, block]) => block.enabled)
            .map(([name]) => name);
        expect(enabled).toEqual(scheduled);
    });

    /**
     * The quickstart's own blocks are complete documents a reader is told to
     * copy, so they are held to the parser the same way the files are — a
     * setup that stopped parsing would surface only as a maintainer's
     * `configRejected` record.
     */
    it("every configuration block in the quickstart parses", () => {
        const quickstart = normalizeNewlines(readFileSync(join(docsDir, "quickstart.md"), "utf8"));
        const blocks = [...quickstart.matchAll(/```yaml\n([\s\S]*?)```/g)].map((m) => m[1]!);
        expect(blocks.length).toBeGreaterThan(1);
        for (const [i, block] of blocks.entries()) {
            const result = parseText(block, `quickstart block ${String(i + 1)}`);
            expect(
                result.ok ? [] : result.errors.map((e) => `${e.code} @ ${e.path}`),
                `quickstart block ${String(i + 1)}`,
            ).toEqual([]);
        }
    });

    /** A file with no README row is one nobody will read; a row with no file is a promise. */
    it("every example is described in the README", () => {
        const readme = readFileSync(join(examplesDir, "README.md"), "utf8");
        for (const file of files) expect(readme).toContain(`\`${file}\``);
    });
});
