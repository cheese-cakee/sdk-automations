/**
 * `design/contracts/catalogue.md` is the closed list of everything a capability
 * may observe, ask, or do — the document P3 and P4 rest on — and until this
 * check it was the only such list nothing read. Four tables, four vocabularies:
 * observations, resolvers, intents with their platform-owned facts, and the
 * meanings. An operation added to the code and not the table is exactly the
 * drift that made the register's D115 gap invisible for a month (D89).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    INTENT_OPERATIONS,
    MAPPABLE_MEANINGS,
    OBSERVATION_NAMES,
    RESOLVER_NAMES,
} from "@hiero-hackers/automation-core";
import { repoRoot } from "./repository.js";

const DOC = join(repoRoot, "design", "contracts", "catalogue.md");

/** The first backtick-quoted token of every row in one `## section`'s table. */
export function rowNames(markdown: string, heading: string): string[] {
    const section = markdown.split(/^## /m).find((s) => s.startsWith(heading));
    expect(section, `section "${heading}" exists`).toBeDefined();
    return [...(section ?? "").matchAll(/^\|\s*`([^`\r\n]+)`\s*\|/gm)].map((m) => m[1]!);
}

/** Every backticked token in one row, so a row's facts can be checked. */
function rowCells(markdown: string, operation: string): string[] {
    const row = markdown.split("\n").find((l) => l.startsWith(`| \`${operation}\``));
    expect(row, `row for ${operation}`).toBeDefined();
    return [...(row ?? "").matchAll(/`([^`\r\n]+)`/g)].map((m) => m[1]!);
}

describe("catalogue.md lists exactly what the code allows", () => {
    const doc = readFileSync(DOC, "utf8");

    it("the observations table is the observation catalogue", () => {
        expect(rowNames(doc, "Observations")).toEqual([...OBSERVATION_NAMES]);
    });

    it("the resolvers table is the resolver catalogue", () => {
        expect(rowNames(doc, "Resolvers")).toEqual([...RESOLVER_NAMES]);
    });

    it("the intents table is the intent catalogue", () => {
        expect(rowNames(doc, "Intents")).toEqual(Object.keys(INTENT_OPERATIONS));
    });

    it("every intent row states the platform's own facts for that operation", () => {
        for (const [operation, facts] of Object.entries(INTENT_OPERATIONS)) {
            const cells = rowCells(doc, operation);
            expect(cells, `${operation} idempotency`).toContain(facts.idempotencyClass);
            expect(cells, `${operation} action class`).toContain(facts.actionClassFloor);
            expect(cells, `${operation} permission`).toContain(facts.permission);
        }
    });

    it("the meanings table is the mappable meanings", () => {
        expect(rowNames(doc, "Meanings")).toEqual([...MAPPABLE_MEANINGS]);
    });

    it("proves the check can fail", () => {
        const forged = "## Intents\n\n| Operation |\n|---|\n| `unassign` |\n| `invented_2` |\n";
        expect(rowNames(`# x\n\n${forged}`, "Intents")).not.toEqual(Object.keys(INTENT_OPERATIONS));
        expect(rowCells("| `unassign` | `login` | `idempotent` |", "unassign")).toEqual([
            "unassign",
            "login",
            "idempotent",
        ]);
        expect(MAPPABLE_MEANINGS.filter((m) => !doc.includes(m))).toEqual([]);
    });
});
