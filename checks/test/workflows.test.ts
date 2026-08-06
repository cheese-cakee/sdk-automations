/**
 * Locks the three security claims the workflow comments make:
 * actions stay SHA-pinned with version comments, fork code never runs through
 * `pull_request_target`, and permissions stay read-only except for the
 * explicit, reviewed write allowlist. Future workflows are covered
 * automatically because the test reads the whole directory.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lines, trackedFiles } from "./helpers.js";

const repoRoot = new URL("../../", import.meta.url);
const workflows = trackedFiles().filter((path) =>
    path.startsWith(".github/workflows/") && /\.ya?ml$/.test(path),
);

/**
 * `security-events` and `id-token` are the Scorecard SARIF upload's declared
 * needs. A future workflow that needs a write must add its file and key here
 * visibly, not by weakening the check.
 */
const WRITE_ALLOWLIST = new Set([
    ".github/workflows/scorecard.yml:security-events",
    ".github/workflows/scorecard.yml:id-token",
]);

function workflowLines(path: string): string[] {
    return lines(readFileSync(join(repoRoot.pathname, path), "utf8"));
}

function permissionWrites(path: string): string[] {
    const writes: string[] = []
    let inPermissions = false
    for (const line of workflowLines(path)) {
        if (/^\s*permissions:\s*$/.test(line)) {
            inPermissions = true
            continue
        }
        if (inPermissions) {
            const match = /^\s+([A-Za-z_-]+):\s*(read|write|none)\s*(?:#.*)?$/.exec(line)
            if (match) {
                if (match[2] === "write") writes.push(`${path}:${match[1]}`)
                continue
            }
            if (/^\S/.test(line)) inPermissions = false
        }
    }
    return writes
}

describe("workflow hygiene stays a checked invariant", () => {
    it("reads every workflow file", () => {
        expect(workflows.length).toBeGreaterThan(0)
    })

    it("pins every action to a full commit SHA with a version comment", () => {
        for (const path of workflows) {
            for (const line of workflowLines(path)) {
                if (!line.includes("uses:")) continue
                const match =
                    /^\s*(?:-\s+)?uses:\s+([^\s#]+)\s+#\s*v.+$/.exec(line)
                expect(match, `${path}: ${line}`).not.toBeNull()
                const ref = match![1]!.split("@").at(-1)!
                expect(ref, `${path}: ${line}`).toMatch(/^[0-9a-f]{40}$/)
            }
        }
    })

    it("never uses pull_request_target", () => {
        for (const path of workflows) {
            expect(
                workflowLines(path).join("\n"),
                `${path} must not contain pull_request_target`,
            ).not.toContain("pull_request_target")
        }
    })

    it("keeps permissions read-only outside the explicit write allowlist", () => {
        const actual = workflows.flatMap(permissionWrites)
        expect([...actual].sort()).toEqual([...WRITE_ALLOWLIST].sort())
    })

    it("proves the pin check can fail in both directions", () => {
        const pin = (ref: string): boolean => /^[0-9a-f]{40}$/.test(ref)
        expect(pin("v4")).toBe(false)
        expect(
            pin("3d3c42e5aac5ba805825da76410c181273ba90b1"),
        ).toBe(true)
    })
})
