/**
 * The worker-side build of `Store`, in one place.
 *
 * A `node:worker_threads` contender cannot import our TypeScript, so both
 * contention suites transpiled `store.ts` and everything it reaches —
 * `schema.ts`, `instants.ts`, core's `ids.ts` — into a scratch directory and
 * pointed the worker at the result. The two copies were identical down to
 * the compiler options. Two copies of a build step is two places to find out
 * it has broken.
 *
 * It breaks in one particular way, which is why it earns a home. It reaches
 * core's `github/ids.ts` BY PATH through `import.meta.resolve`, then rewrites
 * the `@hiero-hackers/automation-core` specifier out of the transpiled store
 * with a string replace. Neither step is an import, so neither the compiler
 * nor dependency-cruiser sees it. Move that file within core, or import the
 * package a second time from `store.ts`, and the failure is a worker that
 * cannot resolve a module at run time. `architecture.test.ts` allowlists this
 * path by name for the same reason, and now has one name to hold.
 *
 * The relative URLs survive the move because they are resolved against the
 * module doing the resolving, and this file sits in the same directory as the
 * suites it was lifted out of. `../src/store.ts` still means the store.
 *
 * Deliberately NOT absorbed: `runConcurrent` and `runFinalizers`. They read
 * like duplicates and are not. One races two fixed contenders over a single
 * delivery. The other runs N finalizers, each with its own optional fault
 * point, and settles on worker exit as well as on a result. A runner
 * parameterised over both would be a fake whose kindness you cannot see —
 * the standing rule in `design/guides/testing.md` §9. Each suite keeps the
 * harness whose shape matches the claim it is making.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as ts from "typescript";

/**
 * Build into `<directory>/worker-build/` and return the store module's file
 * URL, which is what a worker can `import()`.
 */
export function buildWorkerStoreModule(directory: string): string {
    const buildDirectory = join(directory, "worker-build");
    mkdirSync(buildDirectory, { recursive: true });
    const compilerOptions = {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
    };
    const idsSource = readFileSync(
        new URL("github/ids.ts", import.meta.resolve("@hiero-hackers/automation-core")),
        "utf8",
    );
    const storeSource = readFileSync(new URL("../src/store.ts", import.meta.url), "utf8");
    const schemaSource = readFileSync(new URL("../src/schema.ts", import.meta.url), "utf8");
    const instantsSource = readFileSync(new URL("../src/instants.ts", import.meta.url), "utf8");
    writeFileSync(
        join(buildDirectory, "ids.js"),
        ts.transpileModule(idsSource, { compilerOptions }).outputText,
    );
    writeFileSync(
        join(buildDirectory, "schema.js"),
        ts.transpileModule(schemaSource, { compilerOptions }).outputText,
    );
    writeFileSync(
        join(buildDirectory, "instants.js"),
        ts.transpileModule(instantsSource, { compilerOptions }).outputText,
    );
    const storeModule = join(buildDirectory, "store.js");
    writeFileSync(
        storeModule,
        ts
            .transpileModule(storeSource, { compilerOptions })
            .outputText.replace("@hiero-hackers/automation-core", "./ids.js"),
    );
    return pathToFileURL(storeModule).href;
}
