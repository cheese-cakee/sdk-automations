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

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generatedDocuments, rewriteGeneratedBlocks } from "./generated.js";
import { repoRoot } from "./repository.js";

for (const { path, blocks } of generatedDocuments()) {
    const file = join(repoRoot, path);
    const before = readFileSync(file, "utf8");
    const after = rewriteGeneratedBlocks(before, blocks);
    if (after === before) {
        console.log(`unchanged  ${path}`);
        continue;
    }
    writeFileSync(file, after);
    console.log(`rewrote    ${path}`);
}
