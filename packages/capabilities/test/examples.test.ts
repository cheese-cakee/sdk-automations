/**
 * The shipped examples in `docs/examples/` are readable by the capabilities
 * they configure.
 *
 * The repository check (`packages/dev/checks`) parses the same files, but it
 * reads each declaration out of SOURCE TEXT — so a regex that stopped matching
 * would admit every capability with an empty spec and pass in silence. Here
 * the real declarations are objects, carrying the real specs, so an example
 * that reaps before it reminds is refused by the parser the shell runs.
 *
 * Reads the files from the repository root found by walking up, because
 * Stryker runs this suite from a sandbox copy inside the package.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseConfigDocument } from "@hiero-hackers/automation-core";
import { CAPABILITIES } from "../src/index.js";
import { smallestValidSettings } from "./world.js";

function repositoryRoot(): string {
    let dir = dirname(fileURLToPath(import.meta.url));
    while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
        const parent = dirname(dir);
        if (parent === dir) throw new Error("no pnpm-workspace.yaml above this test");
        dir = parent;
    }
    return dir;
}

const examplesDir = join(repositoryRoot(), "docs", "examples");
const files = readdirSync(examplesDir)
    .filter((name) => name.endsWith(".yml"))
    .sort();

/** Every problem the platform finds in one document, as `code @ path`. */
function problemsIn(text: string, revision: string): string[] {
    const parsed = parseConfigDocument(text, {
        revision,
        knownCapabilities: CAPABILITIES.map(({ declaration }) => declaration),
    });
    return parsed.ok ? [] : parsed.errors.map((e) => `${e.code} @ ${String(e.path)}`);
}

/** The one principal a built document declares, for a spec that requires one. */
const PRINCIPALS: Readonly<Record<string, string>> = {
    maintainerTeam: "hiero-hackers/maintainers",
};

/** Every meaning some registered capability demands, with a spelling for it. */
function requiredMappings(): Record<string, Record<string, string>> {
    const families: Record<string, Record<string, string>> = {};
    for (const { declaration } of CAPABILITIES) {
        for (const [family, required] of Object.entries(declaration.requiredMappings)) {
            const spellings = (families[family] ??= {});
            for (const meaning of required ?? []) spellings[meaning] = `mapped: ${meaning}`;
        }
    }
    return families;
}

/**
 * A document enabling exactly the named capabilities, each block written at
 * its own spec's smallest valid settings and its required meanings mapped.
 *
 * JSON rather than hand-written YAML, because YAML is a superset of it: a
 * nested block is then `JSON.stringify` rather than an indenter this suite
 * would have to own and keep right.
 */
function documentEnabling(names: readonly string[]): string {
    const mappings = requiredMappings();
    const offered = {
        mapped: {
            labels: Object.keys(mappings.labels ?? {}),
            commands: Object.keys(mappings.commands ?? {}),
            skills: Object.keys(mappings.skills ?? {}),
            alerts: Object.keys(mappings.alerts ?? {}),
        },
        principals: Object.keys(PRINCIPALS),
    };
    const capabilities: Record<string, unknown> = {};
    for (const name of names) {
        const registered = CAPABILITIES.find(({ declaration }) => declaration.name === name);
        capabilities[name] = {
            enabled: true,
            ...(registered === undefined
                ? {}
                : smallestValidSettings(registered.declaration.settings, offered)),
        };
    }
    return JSON.stringify({ schemaVersion: 2, capabilities, mappings, principals: PRINCIPALS });
}

describe("the shipped examples are readable by the capabilities they configure", () => {
    it("finds the examples at all", () => {
        expect(files.length).toBeGreaterThan(3);
    });

    /**
     * Derived, not listed. This assertion was the registry written out a
     * second time, so every new capability had to edit a file nothing pointed
     * it at — against the promise that one registry line is the whole cost. A
     * document enabling the registry makes the same claim without repeating
     * it, and the count below is the negative control: a derivation from an
     * empty list admits nothing and passes in silence.
     *
     * Each block is written at its own spec's smallest valid settings, because
     * the parser reads a disabled capability's block too (D84) — a capability
     * with a required key joins this test on its registry line alone.
     */
    it("admits every registered capability, and no other", () => {
        const names = CAPABILITIES.map(({ declaration }) => declaration.name);
        expect(names.length).toBeGreaterThanOrEqual(4);
        expect(problemsIn(documentEnabling(names), "every-registered")).toEqual([]);
        expect(problemsIn(documentEnabling([...names, "neverShipped"]), "one-too-many")).toEqual([
            "capabilityUnknown @ capabilities.neverShipped",
        ]);
    });

    it.each(files)("%s reads clean, enabled or not", (file) => {
        const text = readFileSync(join(examplesDir, file), "utf8");
        expect(problemsIn(text, file)).toEqual([]);
    });

    /**
     * The negative control: a value only the capability's own spec can judge.
     * Nothing in the document's own vocabulary is wrong with a ladder that
     * reaps before it reminds — it takes inactivity's spec, and the grace
     * floor `safety/destructive.ts` owns, to see it. Written on the ladder
     * that CONSENTS, because that is the only level the relation is judged at:
     * the same two clocks at the root are a default nobody acts on.
     */
    it("proves the check can fail", () => {
        const reapsFirst = [
            "schemaVersion: 2",
            "capabilities:",
            "  inactivity:",
            "    enabled: false",
            "    remindAfter: 21d",
            "    issues:",
            "      enabled: true",
            "      reap:",
            "        enabled: true",
            "        after: 21d",
            "",
        ].join("\n");
        expect(problemsIn(reapsFirst, "reaps-first")).toEqual([
            "settingInvalid @ capabilities.inactivity.issues.reap.after",
        ]);
    });
});
