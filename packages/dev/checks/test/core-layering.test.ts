/**
 * Core's directories are an audience and a direction (D175): `capability/` is
 * what an author writes against, `intents/` what an effect is once decided, and
 * each directory carries a rank no import climbs to, nested ones named only by
 * their parent. Read as text, like every check about another package (D85). One
 * invariant per file (D89).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { repoRoot, repositoryFiles } from "./repository.js";

const CORE = "packages/core/src";

/** The re-export surface: it names every directory and belongs to none. */
const BARREL = `${CORE}/index.ts`;

/** `catalogue.ts` — the closed vocabulary every directory may name. */
const ROOT = "root";

/**
 * Who sits above whom. The engine composes and the report renders what it
 * decided; `capability/` names the effects an author returns and `intents/`
 * never names back; `author/` is the door onto everything below it.
 */
const RANK: Readonly<Record<string, number>> = {
    github: 0,
    config: 1,
    workflow: 2,
    safety: 3,
    [ROOT]: 4,
    "intents/operations": 5,
    intents: 6,
    capability: 7,
    author: 8,
    report: 9,
    "engine/normalize": 10,
    engine: 11,
};

/** One core file, as the checks read every file they do not import. */
interface Source {
    readonly path: string;
    readonly text: string;
}

/** The directory a core file belongs to; the files at the top are `root`. */
function directoryOf(path: string): string {
    const within = path.slice(CORE.length + 1);
    const cut = within.lastIndexOf("/");
    return cut === -1 ? ROOT : within.slice(0, cut);
}

/** Every relative specifier a file names — `import` and `export … from` alike. */
function specifiersIn(text: string): string[] {
    return [...text.matchAll(/from "(\.[^"]+)"/g)].map((match) => match[1]!);
}

/** Which directory one specifier lands in, or `null` when it leaves core's tree. */
function targetOf(path: string, specifier: string): string | null {
    const landed = posix.normalize(posix.join(posix.dirname(path), specifier));
    return landed.startsWith(`${CORE}/`) ? directoryOf(landed) : null;
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

/** The edges reaching what an author declares from what an effect is. */
function edgesIntoCapability(sources: readonly Source[]): string[] {
    return edges(sources).filter((edge) => {
        const [from, to] = edge.split(" -> ") as [string, string];
        return from.startsWith("intents") && to === "capability";
    });
}

/** The edges that climb into a directory only the engine's own files may name. */
function edgesFromBelow(sources: readonly Source[], top: string): string[] {
    return edges(sources).filter((edge) => {
        const [from, to] = edge.split(" -> ") as [string, string];
        return to.startsWith(top) && !from.startsWith("engine");
    });
}

/** Every file under `core/src/`, the barrel excepted. */
function coreSources(): Source[] {
    return repositoryFiles()
        .filter((path) => path.startsWith(`${CORE}/`) && path.endsWith(".ts") && path !== BARREL)
        .map((path) => ({ path, text: readFileSync(join(repoRoot, path), "utf8") }));
}

describe("core's imports fall", () => {
    const sources = coreSources();

    it("finds core's files", () => {
        expect(sources.length).toBeGreaterThan(40);
        const directories = sources.map(({ path }) => directoryOf(path));
        expect(directories).toContain("intents/operations");
        expect(directories).toContain(ROOT);
    });

    it("draws no edge that climbs", () => {
        expect(climbingEdges(sources)).toEqual([]);
    });

    it("names a nested directory only from its parent", () => {
        expect(nestedEdges(sources)).toEqual([]);
    });

    it("catches a climb, an edge from a directory the rank never named, and a nested reach from a non-parent", () => {
        const climbing = {
            path: `${CORE}/safety/rules.ts`,
            text: 'import { decide } from "../engine/decide.js";',
        };
        expect(climbingEdges([climbing])).toEqual(["safety -> engine"]);
        const unranked = {
            path: `${CORE}/scratch/state.ts`,
            text: 'import { finding } from "../config/index.js";',
        };
        expect(climbingEdges([unranked])).toEqual(["scratch -> config"]);
        const outside = {
            path: `${CORE}/report/convert.ts`,
            text: 'import { assign } from "../intents/operations/assign.js";',
        };
        expect(nestedEdges([outside])).toEqual(["report -> intents/operations"]);
        expect(climbingEdges([outside])).toEqual([]);
        const falling = {
            path: `${CORE}/report/convert.ts`,
            text: 'import { a } from "../intents/index.js";\nimport { b } from "../catalogue.js";',
        };
        expect(climbingEdges([falling])).toEqual([]);
        expect(nestedEdges([falling])).toEqual([]);
    });
});

describe("an intent never names the author who returned it", () => {
    const sources = coreSources();

    it("draws no edge from the effects to the declaration", () => {
        expect(edgesIntoCapability(sources)).toEqual([]);
    });

    it("catches one, from the directory and from its operations", () => {
        const direct = {
            path: `${CORE}/intents/intent.ts`,
            text: 'import type { TypedDeclaration } from "../capability/declaration.js";',
        };
        expect(edgesIntoCapability([direct])).toEqual(["intents -> capability"]);
        const deeper = {
            path: `${CORE}/intents/operations/assign.ts`,
            text: 'import { skipped } from "../../capability/index.js";',
        };
        expect(edgesIntoCapability([deeper])).toEqual(["intents/operations -> capability"]);
        const other = {
            path: `${CORE}/engine/decide.ts`,
            text: 'import { invokeCapability } from "../capability/boundary.js";',
        };
        expect(edgesIntoCapability([other])).toEqual([]);
    });
});

describe("nothing below the engine names the engine, or the report", () => {
    const sources = coreSources();

    it("leaves the composition and its findings unreachable from below", () => {
        expect(edgesFromBelow(sources, "engine")).toEqual([]);
        expect(edgesFromBelow(sources, "report")).toEqual([]);
    });

    it("catches a climb into either, and does not count the engine's own", () => {
        const intoEngine = {
            path: `${CORE}/capability/boundary.ts`,
            text: 'import { EngineHandle } from "../engine/invoke.js";',
        };
        expect(edgesFromBelow([intoEngine], "engine")).toEqual(["capability -> engine"]);
        const intoReport = {
            path: `${CORE}/intents/managed.ts`,
            text: 'import { finding } from "../report/finding.js";',
        };
        expect(edgesFromBelow([intoReport], "report")).toEqual(["intents -> report"]);
        const own = {
            path: `${CORE}/engine/decide.ts`,
            text: 'import { finding } from "../report/index.js";\nimport { x } from "./invoke.js";',
        };
        expect(edgesFromBelow([own], "report")).toEqual([]);
        expect(edgesFromBelow([own], "engine")).toEqual([]);
    });
});
