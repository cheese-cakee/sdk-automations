/**
 * The adapter's directories are a job (D176): `client/` talks to GitHub,
 * `reads/` reads it, `writes/` changes it. Nothing names the barrel, and the
 * client — credentials and the admission gate — names neither side above it
 * (D212). Read as text, like every check about another package (D85). One
 * invariant per file (D89).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { repoRoot, repositoryFiles } from "./repository.js";

const ADAPTER = "packages/runtime/src/adapter";

/** The re-export surface: it names every directory and belongs to none. */
const BARREL = `${ADAPTER}/index.ts`;

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

/** Every edge a file draws out of its own directory. */
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
            path: `${ADAPTER}/client/scratch/probe.ts`,
            text: 'import type { WriteVerbs } from "../../index.js";',
        };
        expect(barrelImporters([deeper])).toEqual([deeper.path]);
        const inner = {
            path: `${ADAPTER}/writes/writes.ts`,
            text: 'import { writeVerbsOf } from "./requests.js";',
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
            text: 'import { REQUESTS } from "../writes/requests.js";',
        };
        expect(edgesFromClient([intoWrites])).toEqual(["client -> writes"]);
        const within = {
            path: `${ADAPTER}/client/admission.ts`,
            text: 'import { writeEndpointOf } from "./endpoints.js";',
        };
        expect(edgesFromClient([within])).toEqual([]);
    });
});
