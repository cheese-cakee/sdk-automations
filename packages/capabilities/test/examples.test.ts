/**
 * The shipped examples in `docs/examples/` are readable by the capabilities
 * they configure.
 *
 * The repository check (`packages/dev/checks`) parses those files through the
 * shared parser, which judges settings by NAME and leaves the values to each
 * capability's spec (D84). That package depends on core alone, so the values
 * can only be judged here, where the specs are: an example that reaps before
 * it reminds would parse clean there and be reported as unusable on every
 * delivery in a maintainer's repository.
 *
 * Reads the files from the repository root found by walking up, because
 * Stryker runs this suite from a sandbox copy inside the package.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
    parseConfigDocument,
    projectCapabilityView,
    readSettings,
    type Spec,
    type TypedDeclaration,
} from "@hiero-hackers/automation-core";
import {
    CAPABILITIES,
    inactivityDeclaration,
    intakeDeclaration,
    prQualityDeclaration,
} from "../src/index.js";
import { INACTIVITY_SETTINGS } from "../src/inactivity/settings.js";
import { INTAKE_SETTINGS } from "../src/intake/settings.js";
import { PR_QUALITY_SETTINGS } from "../src/prQuality/settings.js";

/** Each shipped capability beside the spec its `evaluate` reads with. */
const SPECS: readonly { readonly declaration: TypedDeclaration; readonly spec: Spec }[] = [
    { declaration: intakeDeclaration, spec: INTAKE_SETTINGS },
    { declaration: prQualityDeclaration, spec: PR_QUALITY_SETTINGS },
    { declaration: inactivityDeclaration, spec: INACTIVITY_SETTINGS },
];

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

const parse = (text: string, revision: string) =>
    parseConfigDocument(text, {
        revision,
        knownCapabilities: SPECS.map(({ declaration }) => declaration),
    });

/** Every problem every configured capability finds in one document, as paths. */
function problemsIn(text: string, revision: string): string[] {
    const parsed = parse(text, revision);
    if (!parsed.ok) return parsed.errors.map((e) => `${e.code} @ ${e.path}`);
    return SPECS.flatMap(({ declaration, spec }) => {
        if (!Object.hasOwn(parsed.config.capabilities, declaration.name)) return [];
        const result = readSettings(spec, projectCapabilityView(declaration, parsed.config));
        return result.ok
            ? []
            : result.problems.map((p) => `${declaration.name}: ${p.path} — ${p.message}`);
    });
}

describe("the shipped examples are readable by the capabilities they configure", () => {
    it("pairs every registered capability with its spec, and no other", () => {
        expect(SPECS.map(({ declaration }) => declaration.name)).toEqual(
            CAPABILITIES.map(({ declaration }) => declaration.name),
        );
    });

    it("finds the examples at all", () => {
        expect(files.length).toBeGreaterThan(3);
    });

    it.each(files)("%s reads clean, enabled or not", (file) => {
        const text = readFileSync(join(examplesDir, file), "utf8");
        expect(problemsIn(text, file)).toEqual([]);
    });

    /** The negative control: a value the parser accepts and the spec refuses. */
    it("proves the check can fail", () => {
        const reapsFirst = [
            "schemaVersion: 1",
            "capabilities:",
            "  inactivity:",
            "    enabled: false",
            "    settings:",
            "      remindAfterDays: 21",
            "      reapAfterDays: 21",
            "",
        ].join("\n");
        expect(parse(reapsFirst, "reaps-first").ok).toBe(true);
        expect(problemsIn(reapsFirst, "reaps-first")).toEqual([
            "inactivity: reapAfterDays — must be at least 1 day(s) above remindAfterDays (21)",
        ]);
    });
});
