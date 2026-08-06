/**
 * What the lab brainstorm left behind that is checkable TODAY, without
 * building anything.
 *
 * Two invariants. The first guards the lab's local-only layer: `lab/harness/`
 * (era-1 code and the private evidence archive), `lab/evidence/` bulk, and
 * `lab/.env` hold sandbox credentials and unscrubbed payloads and must never
 * be tracked — a `git add -f` would bypass the ignore silently. Evidence
 * enters the repository only as reviewed fixtures in core, never through
 * the lab (protocol 7.1). The second locks the provenance table in
 * `core/src/github/README.md` to the code it describes; writing it exposed
 * that the table already disagreed with the code (the README credited
 * experiment 6.4 for facts the code stamps 6.1).
 */

import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BODY_PATTERNS } from "@hiero-hackers/automation-core";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const tracked = (path: string): string[] =>
    execSync(`git ls-files -- ${path}`, { cwd: repoRoot, encoding: "utf8" })
        .split("\n")
        .filter(Boolean);

describe("the lab's local-only layer stays out of the repository", () => {
    it(".gitignore still carries the rules", () => {
        const lines = readFileSync(join(repoRoot, ".gitignore"), "utf8").split("\n");
        for (const rule of ["lab/harness/", "lab/evidence/", "lab/.env"]) {
            expect(lines).toContain(rule);
        }
    });

    /**
     * The invariant itself. The ignore lines only prevent accidents, not
     * force-adds; this fails on both.
     */
    it("git tracks nothing local-only", () => {
        expect(tracked("lab/harness/")).toEqual([]);
        expect(tracked("lab/evidence/")).toEqual([]);
        expect(tracked("lab/.env")).toEqual([]);
    });

    it("proves the instrument can fail", () => {
        // The same command on a tracked path returns entries, so an empty
        // answer above means "nothing tracked", not "command broken".
        expect(tracked("core/package.json")).toEqual(["core/package.json"]);
    });
});

/**
 * `core/src/github/README.md` carries a provenance table — file, probing
 * experiment, date — and the code carries the same facts on each pattern.
 * One fact, two homes, kept honest the same way the docs tables are.
 */
describe("the perishable-facts provenance table matches the code", () => {
    const readme = readFileSync(
        join(repoRoot, "core/src/github/README.md"),
        "utf8",
    );
    const row = readme
        .split("\n")
        .find((line) => line.startsWith("| `failures.ts` |"));

    it("has a row for failures.ts", () => {
        expect(row).toBeDefined();
    });

    it("the row's date is every pattern's probedAt", () => {
        for (const [name, entry] of Object.entries(BODY_PATTERNS)) {
            expect(row, `date for ${name}`).toContain(entry.probedAt);
        }
    });

    it("the row credits every experiment the code cites, and no other", () => {
        const inCode = new Set(
            Object.values(BODY_PATTERNS).map((entry) => entry.experiment),
        );
        const inRow = new Set(
            [...(row ?? "").matchAll(/\b(\d+\.\d+)\b/g)]
                .map((m) => m[1]!)
                // the date's day-fragments are not experiment numbers
                .filter((n) => !(row ?? "").includes(`-${n}`)),
        );
        expect([...inRow].sort()).toEqual([...inCode].sort());
    });

    it("every file the table names exists in src/github", () => {
        const named = [...readme.matchAll(/^\| `([a-z-]+\.ts)` \|/gm)].map(
            (m) => m[1]!,
        );
        expect(named.length).toBeGreaterThan(2);
        for (const name of named) {
            expect(
                tracked(`core/src/github/${name}`),
                `${name} exists and is tracked`,
            ).toHaveLength(1);
        }
    });
});
