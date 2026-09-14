/**
 * The shell's directories are a direction (D172): each carries a rank no import
 * climbs to, and a nested directory is named only by its parent. Only the
 * applier's table names the fold's five states, and only the shared box calls
 * the applier. Read as text, like every check about another package (D85). One
 * invariant per file (D89).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { repoRoot, repositoryFiles } from "./repository.js";

const SHELL = "packages/runtime/src/shell";

/** The re-export surface: it names every directory and belongs to none. */
const BARREL = `${SHELL}/index.ts`;

/** `log.ts`, `paths.ts` and `effects.ts` — the vocabulary any directory may name. */
const ROOT = "root";

/**
 * Who sits above whom. `compose` composes; the lanes and the tick's jobs reach
 * the shared box and the applier; `apply` reaches only its operations and the
 * root; `observe` reads. Nothing at all names `compose`.
 */
const RANK: Readonly<Record<string, number>> = {
    [ROOT]: 0,
    observe: 1,
    "apply/operations": 1,
    apply: 2,
    decide: 3,
    inbound: 4,
    sweep: 4,
    jobs: 5,
    compose: 6,
};

/** One shell file, as the checks read every file they do not import. */
interface Source {
    readonly path: string;
    readonly text: string;
}

/** The directory a shell file belongs to; the files at the top are `root`. */
function directoryOf(path: string): string {
    const within = path.slice(SHELL.length + 1);
    const cut = within.lastIndexOf("/");
    return cut === -1 ? ROOT : within.slice(0, cut);
}

/** Every relative specifier a file names — `import` and `export … from` alike. */
function specifiersIn(text: string): string[] {
    return [...text.matchAll(/from "(\.[^"]+)"/g)].map((match) => match[1]!);
}

/** Which directory one specifier lands in, or `null` when it leaves the shell. */
function targetOf(path: string, specifier: string): string | null {
    const landed = posix.normalize(posix.join(posix.dirname(path), specifier));
    return landed.startsWith(`${SHELL}/`) ? directoryOf(landed) : null;
}

/** Every edge a file draws out of its own directory, as the rank ranks one. */
function edgesIn({ path, text }: Source): string[] {
    const from = directoryOf(path);
    return specifiersIn(text)
        .map((specifier) => targetOf(path, specifier))
        .filter((to): to is string => to !== null && to !== from)
        .map((to) => `${from} -> ${to}`);
}

/** Every edge the tree draws, each once. */
function edges(sources: readonly Source[]): string[] {
    return [...new Set(sources.flatMap(edgesIn))].sort();
}

/** Every edge that fails to fall: a landing at or above the start, or an end the rank never named. */
function climbingEdges(sources: readonly Source[]): string[] {
    return edges(sources).filter((edge) => {
        const [from, to] = edge.split(" -> ") as [string, string];
        const start = RANK[from];
        const landing = RANK[to];
        return start === undefined || landing === undefined || landing >= start;
    });
}

/** Every reach into a nested directory from something other than its parent. */
function nestedEdges(sources: readonly Source[]): string[] {
    return edges(sources).filter((edge) => {
        const [from, to] = edge.split(" -> ") as [string, string];
        const cut = to.lastIndexOf("/");
        return cut !== -1 && to.slice(0, cut) !== from;
    });
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

describe("the shell's imports fall", () => {
    const sources = shellSources();

    it("finds the shell's files", () => {
        expect(sources.length).toBeGreaterThan(20);
        expect(sources.map(({ path }) => directoryOf(path))).toContain("apply/operations");
    });

    it("draws no edge that climbs", () => {
        expect(climbingEdges(sources)).toEqual([]);
    });

    it("names a nested directory only from its parent", () => {
        expect(nestedEdges(sources)).toEqual([]);
    });

    it("catches a climb, an edge at one rank, and a nested reach from a non-parent", () => {
        const climbing = {
            path: `${SHELL}/apply/gates.ts`,
            text: 'import { warn } from "../decide/externals.js";',
        };
        expect(climbingEdges([climbing])).toEqual(["apply -> decide"]);
        const level = {
            path: `${SHELL}/inbound/deliveries.ts`,
            text: 'import { fire } from "../sweep/sweep.js";',
        };
        expect(climbingEdges([level])).toEqual(["inbound -> sweep"]);
        const outside = {
            path: `${SHELL}/decide/decisions.ts`,
            text: 'import { assign } from "../apply/operations/assign.js";',
        };
        expect(nestedEdges([outside])).toEqual(["decide -> apply/operations"]);
        expect(climbingEdges([outside])).toEqual([]);
        const falling = {
            path: `${SHELL}/decide/item.ts`,
            text: 'import { a } from "../apply/apply.js";\nimport { b } from "../log.js";',
        };
        expect(climbingEdges([falling])).toEqual([]);
        expect(nestedEdges([falling])).toEqual([]);
    });
});

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
