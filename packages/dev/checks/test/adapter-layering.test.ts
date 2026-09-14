/**
 * The adapter's directories are a job (D176): `client/` talks to GitHub,
 * `reads/` reads it, `writes/` changes it, and each carries a rank no import
 * climbs to, nested ones named only by their parent. Nothing names the barrel,
 * and the client names neither side above it. Read as text, like every check
 * about another package (D85). One invariant per file (D89).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { repoRoot, repositoryFiles } from "./repository.js";

const ADAPTER = "packages/runtime/src/adapter";

/** The re-export surface: it names every directory and belongs to none. */
const BARREL = `${ADAPTER}/index.ts`;

/**
 * Who sits above whom. The reads sit on the client; the writes sit on both,
 * because a read-back proves a write through the facts reader; the client sits
 * on nothing here, which is what lets the admission gate hold the shapes.
 */
const RANK: Readonly<Record<string, number>> = {
    client: 0,
    reads: 1,
    "writes/operations": 2,
    writes: 3,
};

/** One adapter file, as the checks read every file they do not import. */
interface Source {
    readonly path: string;
    readonly text: string;
}

/** The directory an adapter file belongs to. */
function directoryOf(path: string): string {
    const within = path.slice(ADAPTER.length + 1);
    const cut = within.lastIndexOf("/");
    return cut === -1 ? "root" : within.slice(0, cut);
}

/** Every relative specifier a file names — `import` and `export … from` alike. */
function specifiersIn(text: string): string[] {
    return [...text.matchAll(/from "(\.[^"]+)"/g)].map((match) => match[1]!);
}

/** Where one specifier lands as a file, or `null` when it leaves the adapter's tree. */
function landingOf(path: string, specifier: string): string | null {
    const landed = posix.normalize(posix.join(posix.dirname(path), specifier));
    return landed.startsWith(`${ADAPTER}/`) ? landed.replace(/\.js$/, ".ts") : null;
}

/** Every edge a file draws out of its own directory, as the rank ranks one. */
function edgesIn({ path, text }: Source): string[] {
    const from = directoryOf(path);
    return specifiersIn(text)
        .map((specifier) => landingOf(path, specifier))
        .filter((landed): landed is string => landed !== null)
        .map(directoryOf)
        .filter((to) => to !== from)
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

/** Every file that reaches the adapter's own barrel; from inside, nothing may. */
function barrelImporters(sources: readonly Source[]): string[] {
    return sources
        .filter(({ path, text }) =>
            specifiersIn(text).some((specifier) => landingOf(path, specifier) === BARREL),
        )
        .map(({ path }) => path)
        .sort();
}

/** The edges climbing out of the client into either side that sits on it. */
function edgesFromClient(sources: readonly Source[]): string[] {
    return edges(sources).filter((edge) => {
        const [from, to] = edge.split(" -> ") as [string, string];
        return from === "client" && (to === "reads" || to.startsWith("writes"));
    });
}

/** Every file under `src/adapter/`, the barrel excepted. */
function adapterSources(): Source[] {
    return repositoryFiles()
        .filter((path) => path.startsWith(`${ADAPTER}/`) && path.endsWith(".ts") && path !== BARREL)
        .map((path) => ({ path, text: readFileSync(join(repoRoot, path), "utf8") }));
}

describe("the adapter's imports fall", () => {
    const sources = adapterSources();

    it("finds the adapter's files, and none outside the three jobs", () => {
        expect(sources.length).toBeGreaterThan(15);
        const directories = [...new Set(sources.map(({ path }) => directoryOf(path)))].sort();
        expect(directories).toEqual(["client", "reads", "writes", "writes/operations"]);
    });

    it("draws no edge that climbs", () => {
        expect(climbingEdges(sources)).toEqual([]);
    });

    it("names a nested directory only from its parent", () => {
        expect(nestedEdges(sources)).toEqual([]);
    });

    it("catches a climb, an edge from a directory the rank never named, and a nested reach from a non-parent", () => {
        const climbing = {
            path: `${ADAPTER}/reads/facts.ts`,
            text: 'import { createReadBack } from "../writes/readback.js";',
        };
        expect(climbingEdges([climbing])).toEqual(["reads -> writes"]);
        const unranked = {
            path: `${ADAPTER}/scratch/probe.ts`,
            text: 'import { a } from "../client/contract.js";',
        };
        expect(climbingEdges([unranked])).toEqual(["scratch -> client"]);
        const outside = {
            path: `${ADAPTER}/reads/facts.ts`,
            text: 'import { assign } from "../writes/operations/assign.js";',
        };
        expect(nestedEdges([outside])).toEqual(["reads -> writes/operations"]);
        const falling = {
            path: `${ADAPTER}/writes/readback.ts`,
            text: 'import { a } from "../client/contract.js";\nimport { b } from "../reads/facts.js";',
        };
        expect(climbingEdges([falling])).toEqual([]);
        expect(nestedEdges([falling])).toEqual([]);
    });
});

describe("nothing inside the adapter names its barrel", () => {
    const sources = adapterSources();

    it("leaves the re-export surface for the consumers", () => {
        expect(barrelImporters(sources)).toEqual([]);
    });

    it("catches a file reaching the barrel, from either depth", () => {
        const beside = {
            path: `${ADAPTER}/reads/config.ts`,
            text: 'import type { FactsReader } from "../index.js";',
        };
        expect(barrelImporters([beside])).toEqual([beside.path]);
        const deeper = {
            path: `${ADAPTER}/writes/operations/lockIssue.ts`,
            text: 'import type { WriteVerbs } from "../../index.js";',
        };
        expect(barrelImporters([deeper])).toEqual([deeper.path]);
        const inner = {
            path: `${ADAPTER}/writes/writes.ts`,
            text: 'import { writeVerbsOf } from "./operations/index.js";',
        };
        expect(barrelImporters([inner])).toEqual([]);
    });
});

describe("the client names neither the reads nor the writes", () => {
    const sources = adapterSources();

    it("keeps the credentials and the admission gate under nothing", () => {
        expect(edgesFromClient(sources)).toEqual([]);
    });

    it("catches a climb into either side", () => {
        const intoReads = {
            path: `${ADAPTER}/client/http.ts`,
            text: 'import { createFactsReader } from "../reads/facts.js";',
        };
        expect(edgesFromClient([intoReads])).toEqual(["client -> reads"]);
        const intoWrites = {
            path: `${ADAPTER}/client/admission.ts`,
            text: 'import { writeEndpointOf } from "../writes/operations/index.js";',
        };
        expect(edgesFromClient([intoWrites])).toEqual(["client -> writes/operations"]);
        const within = {
            path: `${ADAPTER}/client/admission.ts`,
            text: 'import { writeEndpointOf } from "./endpoints.js";',
        };
        expect(edgesFromClient([within])).toEqual([]);
    });
});
