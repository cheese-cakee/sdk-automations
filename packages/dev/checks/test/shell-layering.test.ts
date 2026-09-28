/**
 * Two rules the shell's shape carries (D172, D212): only the applier's table names
 * the fold's five states, and only the shared box calls the applier. Read as text,
 * like every check about another package (D85). One invariant per file (D89).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, repositoryFiles } from "./repository.js";

const SHELL = "packages/runtime/src/shell";

/** The re-export surface: it names every directory and belongs to none. */
const BARREL = `${SHELL}/index.ts`;

/** One shell file, as the checks read every file they do not import. */
interface Source {
    readonly path: string;
    readonly text: string;
}

/** The five the fold hands the applier, as a case names one. */
const STATES = ["neverStarted", "resumable", "open", "settled", "inconsistent"] as const;

/** Where the five become one row each. */
const TABLE = `${SHELL}/apply/actions.ts`;

/** The one other file that may spell a state: it renders one to a reader, and acts on none. */
const RENDERER = `${SHELL}/observe/explain.ts`;

/** Which of the five a file spells as a value; a word in prose is not one. */
function statesNamedIn({ text }: Source): string[] {
    return STATES.filter((state) => text.includes(`"${state}"`));
}

/** The files that spell a state and are neither the table nor the renderer. */
function statesNamedElsewhere(sources: readonly Source[]): string[] {
    return sources
        .filter(({ path }) => path !== TABLE && path !== RENDERER)
        .filter((source) => statesNamedIn(source).length > 0)
        .map(({ path }) => path)
        .sort();
}

/** Where the applier is driven from. */
const CALLER = `${SHELL}/decide/item.ts`;

/** Every file that CALLS the applier; `apply.ts` declares the method and calls none. */
function appliersCalledIn(sources: readonly Source[]): string[] {
    return sources
        .filter(({ text }) => text.includes(".applyAll("))
        .map(({ path }) => path)
        .sort();
}

/** Every file under `src/shell/`, the barrel excepted. */
function shellSources(): Source[] {
    return repositoryFiles()
        .filter((path) => path.startsWith(`${SHELL}/`) && path.endsWith(".ts") && path !== BARREL)
        .map((path) => ({ path, text: readFileSync(join(repoRoot, path), "utf8") }));
}

describe("one file names the fold's five states", () => {
    const sources = shellSources();

    it("names all five in the applier's table", () => {
        const table = sources.find(({ path }) => path === TABLE);
        expect(statesNamedIn(table!)).toEqual([...STATES]);
    });

    it("names none of them anywhere else that acts on one", () => {
        expect(statesNamedElsewhere(sources)).toEqual([]);
    });

    it("catches a state named outside the table", () => {
        const elsewhere = {
            path: `${SHELL}/inbound/deliveries.ts`,
            text: 'if (state.kind === "resumable") return;',
        };
        expect(statesNamedElsewhere([elsewhere])).toEqual([elsewhere.path]);
        const prose = {
            path: `${SHELL}/inbound/deliveries.ts`,
            text: "// the send stays open until the switch lifts\nconst open = 1;",
        };
        expect(statesNamedElsewhere([prose])).toEqual([]);
    });
});

describe("one file calls the applier", () => {
    const sources = shellSources();

    it("is the shared box, and nothing else", () => {
        expect(appliersCalledIn(sources)).toEqual([CALLER]);
    });

    it("catches a second caller, and does not count the declaration", () => {
        const second = {
            path: `${SHELL}/sweep/sweep.ts`,
            text: "await applier.applyAll(approved, config, budget);",
        };
        expect(appliersCalledIn([second])).toEqual([second.path]);
        const declaration = {
            path: `${SHELL}/apply/apply.ts`,
            text: "    applyAll(effects: readonly Effect[]): Promise<EffectOutcome[]>;",
        };
        expect(appliersCalledIn([declaration])).toEqual([]);
    });
});
