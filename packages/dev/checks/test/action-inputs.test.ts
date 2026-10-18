/**
 * The Action's inputs are one fact in two places: `action.yml` declares them,
 * the parser reads them as `INPUT_<NAME>` environment variables. A declared
 * input nobody reads is a setting that does nothing; a read input nobody
 * declares can never be set. Both directions are held, and every input says
 * what it is and what it defaults to.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { actionParserSource, repoRoot } from "./repository.js";

interface ActionManifest {
    readonly inputs?: Readonly<
        Record<string, { readonly description?: unknown; readonly default?: unknown } | null>
    >;
}

/** GitHub upper-cases an input's name and keeps its hyphens. */
function environmentName(input: string): string {
    return `INPUT_${input.toUpperCase()}`;
}

function declaredInputs(manifestText: string): ActionManifest["inputs"] {
    return (parse(manifestText) as ActionManifest).inputs ?? {};
}

/** The `INPUT_*` names the parser reads, as `env["INPUT_X"]`. */
function readEnvironmentNames(parserText: string): string[] {
    const names = [...parserText.matchAll(/env\["(INPUT_[A-Z0-9_-]+)"\]/g)].map((m) => m[1]!);
    return [...new Set(names)].sort();
}

describe("the Action's inputs", () => {
    const manifest = readFileSync(join(repoRoot, "action.yml"), "utf8");

    it("are the INPUT_ names the parser reads, both ways", () => {
        const declared = Object.keys(declaredInputs(manifest) ?? {})
            .map(environmentName)
            .sort();
        const read = readEnvironmentNames(actionParserSource());

        expect(read.length).toBeGreaterThan(0);
        expect(declared).toEqual(read);
    });

    it("each carry a description and a default", () => {
        const incomplete = Object.entries(declaredInputs(manifest) ?? {})
            .filter(
                ([, input]) =>
                    typeof input?.description !== "string" ||
                    input.description.trim() === "" ||
                    input.default === undefined,
            )
            .map(([name]) => name);

        expect(incomplete).toEqual([]);
    });

    it("proves the check can fail", () => {
        const parser = 'env["INPUT_TOKEN"] ?? "", env["INPUT_ARM-WRITES"]';
        expect(readEnvironmentNames(parser)).toEqual(["INPUT_ARM-WRITES", "INPUT_TOKEN"]);
        expect(environmentName("arm-writes")).toBe("INPUT_ARM-WRITES");

        // Declared but unread, and read but undeclared.
        const declared = Object.keys(declaredInputs("inputs:\n  token: {}\n  extra: {}\n") ?? {})
            .map(environmentName)
            .sort();
        expect(declared).not.toEqual(readEnvironmentNames(parser));

        // An input with no default, and one with no description.
        const forged = declaredInputs("inputs:\n  a:\n    description: x\n  b:\n    default: y\n");
        expect(forged?.["a"]?.default).toBeUndefined();
        expect(forged?.["b"]?.description).toBeUndefined();
    });
});
