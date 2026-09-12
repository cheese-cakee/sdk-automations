/**
 * `design/contracts/catalogue.md` is the closed list of everything a capability
 * may read, ask, or do — the document P3 and P4 rest on — and until this check
 * it was the only such list nothing read. An operation added to the code and
 * not the table is exactly the drift that made the register's D115 gap
 * invisible for a month (D89).
 *
 * The lock used to compare column by column: a row list here, three facts
 * there, and every other cell free. Now the tables are GENERATED
 * (`generated.ts`) and the whole block is compared, so the invariant is one
 * sentence — the file holds what the registries say — and the repair is
 * `pnpm contracts` rather than a hand edit that has to guess what changed.
 *
 * `design/contracts/facts.md` holds the shapes those kinds have, and its
 * producer table says which producer reads which group. That table is
 * generated too now — core knows the producers, because a declared trigger
 * names one — so the second block below is the same whole-block comparison
 * against `PRODUCERS`.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FACT_GROUPS } from "@hiero-hackers/automation-core";
import { readGeneratedBlock, renderCatalogueTables, renderProducerTable } from "./generated.js";
import { normalizeNewlines, repoRoot } from "./repository.js";

const DOC = join(repoRoot, "design", "contracts", "catalogue.md");
const FACTS_DOC = join(repoRoot, "design", "contracts", "facts.md");

describe("catalogue.md holds the tables the registries generate", () => {
    const doc = normalizeNewlines(readFileSync(DOC, "utf8"));

    it("every generated block is what the file holds", () => {
        for (const { name, markdown } of renderCatalogueTables()) {
            // Vitest prints the string diff, which names the drifted row.
            expect(readGeneratedBlock(doc, name), `run \`pnpm contracts\` — ${name}`).toEqual(
                markdown,
            );
        }
    });

    it("proves the check can fail", () => {
        // Negative control, both halves: a block whose rows were edited by
        // hand no longer matches, and a document with no markers at all reads
        // as absent rather than as agreement.
        const [facts] = renderCatalogueTables();
        const forged = `<!-- generated: facts -->\n| Kind |\n|---|\n| \`invented\` |\n<!-- /generated -->`;
        expect(readGeneratedBlock(forged, "facts")).not.toEqual(facts?.markdown);
        expect(readGeneratedBlock("# no markers here", "facts")).toBeNull();
        expect(renderCatalogueTables().map(({ name }) => name)).toEqual([
            "facts",
            "resolvers",
            "intents",
            "meanings",
        ]);
    });
});

describe("facts.md holds the producer table the registry generates", () => {
    const doc = normalizeNewlines(readFileSync(FACTS_DOC, "utf8"));

    it("every generated block is what the file holds", () => {
        for (const { name, markdown } of renderProducerTable()) {
            expect(readGeneratedBlock(doc, name), `run \`pnpm contracts\` — ${name}`).toEqual(
                markdown,
            );
        }
    });

    /**
     * The columns are the half a row list cannot reach: a group added to the
     * code leaves the one document that says who reads it silently incomplete
     * unless the header grows with it.
     */
    it("its columns are the projection and every fact group", () => {
        const [producers] = renderProducerTable();
        expect(producers?.markdown.split("\n")[0]).toBe(
            `| Producer | Kind | position | ${FACT_GROUPS.join(" | ")} |`,
        );
    });

    it("proves the check can fail", () => {
        const [producers] = renderProducerTable();
        const forged = `<!-- generated: producers -->\n| Producer |\n|---|\n| \`invented\` |\n<!-- /generated -->`;
        expect(readGeneratedBlock(forged, "producers")).not.toEqual(producers?.markdown);
        expect(readGeneratedBlock("# no markers here", "producers")).toBeNull();
        expect(renderProducerTable().map(({ name }) => name)).toEqual(["producers"]);
    });
});
