/**
 * Core's directories are an audience (D175): `capability/` is what an author
 * writes against, `intents/` what an effect is once decided, and neither names
 * the engine that composes them (D212). Read as text, like every check about
 * another package (D85). One invariant per file (D89).
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

/** Every edge a file draws out of its own directory. */
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
