/**
 * `pnpm contracts` — rewrite every generated table in place.
 *
 * The fix for a red contract lock, and the reason the locks can compare whole
 * tables rather than a column each: a check whose repair is "edit this
 * markdown by hand until the diff goes away" is a check people learn to
 * silence. Nothing here decides anything — `generated.ts` renders, this walks
 * the documents and writes.
 *
 * Run by `tsx`, the runner the workspace already uses for its scripts: core
 * ships TypeScript sources with `.js` specifiers, which `node` cannot resolve
 * on its own.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generatedDocuments, generatedFiles, rewriteGeneratedBlocks } from "./generated.js";
import { repoRoot } from "./repository.js";

/** Write only a changed file, so a second run reports `unchanged` for everything. */
function write(path: string, before: string | null, after: string): void {
    if (after === before) {
        console.log(`unchanged  ${path}`);
        return;
    }
    writeFileSync(join(repoRoot, path), after);
    console.log(`rewrote    ${path}`);
}

for (const { path, blocks } of generatedDocuments()) {
    const before = readFileSync(join(repoRoot, path), "utf8");
    write(path, before, rewriteGeneratedBlocks(before, blocks));
}

// A whole-file output has no markers to rewrite between, so the first run of a
// new one writes a file that is not there yet.
for (const { path, text } of generatedFiles()) {
    const file = join(repoRoot, path);
    write(path, existsSync(file) ? readFileSync(file, "utf8") : null, text);
}
