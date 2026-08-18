/**
 * The four security claims the workflow comments make, as checks: actions
 * SHA-pinned with version comments, no `pull_request_target`, permissions
 * read-only outside an explicit allowlist, and no checkout persisting the
 * token. The whole directory is read, because this class regresses through a
 * NEW job that quietly omits the hardening rather than through a removal (D100).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { lines, repoRoot, trackedFiles } from "./repository.js";

const workflows = trackedFiles().filter(
    (path) => path.startsWith(".github/workflows/") && /\.ya?ml$/.test(path),
);

/**
 * The SARIF uploads' declared needs. A workflow that needs a write must add
 * its file and key here visibly, rather than weaken the check.
 */
const WRITE_ALLOWLIST = new Set([
    ".github/workflows/scorecard.yml:security-events",
    ".github/workflows/scorecard.yml:id-token",
    // CodeQL's SARIF upload, declared on the analyze job only so no other
    // step can inherit it (D101, #42).
    ".github/workflows/codeql.yml:security-events",
]);

function workflowText(path: string): string {
    return readFileSync(join(repoRoot, path), "utf8");
}

function workflowLines(path: string): string[] {
    return lines(workflowText(path));
}

/** A `permissions:` value, in every shape the Actions schema allows. */
type PermissionBlock = string | Readonly<Record<string, unknown>> | null | undefined;

/** A step, in the two parts these checks ask about: what it runs, and its inputs. */
interface WorkflowStep {
    readonly uses?: unknown;
    readonly with?: Readonly<Record<string, unknown>>;
}

interface WorkflowJob {
    readonly permissions?: PermissionBlock;
    readonly steps?: readonly (WorkflowStep | null)[] | null;
}

interface WorkflowDocument {
    readonly permissions?: PermissionBlock;
    readonly jobs?: Readonly<Record<string, WorkflowJob | null>>;
}

/** A workflow as the Actions schema describes it, or nothing if it is not a mapping. */
function workflowDocument(text: string): WorkflowDocument | null {
    const document = parse(text) as WorkflowDocument | null;
    return document !== null && typeof document === "object" ? document : null;
}

/** Every step of every job, flattened — the level both step checks work at. */
function steps(text: string): WorkflowStep[] {
    return Object.values(workflowDocument(text)?.jobs ?? {}).flatMap((job) =>
        [...(job?.steps ?? [])].filter(
            (step): step is WorkflowStep => step !== null && typeof step === "object",
        ),
    );
}

/** What each step runs. A step without `uses:` runs `run:` and is not an action. */
function actionRefs(text: string): string[] {
    return steps(text)
        .map((step) => step.uses)
        .filter((uses): uses is string => typeof uses === "string");
}

/**
 * The checkouts that leave the token behind, as `<path>: <ref>`.
 *
 * Parsed, never scanned line by line, for the reason `permissionWrites` is:
 * the forward line scan this replaced read a COMMENTED-OUT flag as the flag
 * being set, missed the quoted `'false'` the action honours, and never saw a
 * step written as a flow mapping, where the setting shares the `uses:` line.
 * Actions inputs cross the wire as strings, so `false` and `'false'` are the
 * same instruction to the action, and both drop the token.
 */
function persistingCheckouts(path: string, text: string): string[] {
    const persisting: string[] = [];
    for (const step of steps(text)) {
        if (typeof step.uses !== "string" || !step.uses.startsWith("actions/checkout@")) continue;
        const flag = step.with?.["persist-credentials"];
        if (flag !== false && flag !== "false") persisting.push(`${path}: ${step.uses}`);
    }
    return persisting;
}

/**
 * The writes one block grants, as `<path>:<scope>`.
 *
 * `write-all` reports under that name rather than expanding to every scope:
 * it is a different decision from granting one scope, and no allowlist entry
 * naming a scope should ever match it.
 */
function writesIn(path: string, block: PermissionBlock): string[] {
    if (block === null || block === undefined) return [];
    if (typeof block === "string") return block === "write-all" ? [`${path}:write-all`] : [];
    return Object.entries(block)
        .filter(([, level]) => level === "write")
        .map(([scope]) => `${path}:${scope}`);
}

/**
 * Parsed, never scanned line by line. A regex reading `permissions:` off its
 * own line is blind to a flow mapping, a quoted `"write"`, and the
 * `write-all` shorthand — three legal spellings of the grant this check
 * exists to refuse, each of which passed silently. Same argument, same
 * parser, as `mutation-coverage.test.ts` reading `ci.yml`.
 *
 * Both levels the schema permits: the workflow's own block, and each job's.
 */
function permissionWrites(path: string, text: string): string[] {
    const document = workflowDocument(text);
    if (document === null) return [];
    const jobs = Object.values(document.jobs ?? {});
    return [
        ...writesIn(path, document.permissions),
        ...jobs.flatMap((job) => writesIn(path, job?.permissions)),
    ];
}

describe("workflow hygiene stays a checked invariant", () => {
    it("reads every workflow file", () => {
        expect(workflows.length).toBeGreaterThan(0);
    });

    /**
     * The ref comes from the parser, not from a `uses:` substring test: that
     * test also fires on a comment that happens to contain the word and on a
     * local `./.github/actions/…` composite, neither of which can carry a SHA.
     * A local action moves with this repository, so pinning it names nothing.
     */
    it("pins every third-party action to a full commit SHA", () => {
        for (const path of workflows) {
            for (const ref of actionRefs(workflowText(path))) {
                if (ref.startsWith("./")) continue;
                expect(ref.split("@").at(-1), `${path}: ${ref}`).toMatch(/^[0-9a-f]{40}$/);
            }
        }
    });

    /**
     * A SHA nobody can read is a SHA nobody updates, so each pin names the
     * version it stands for. Comments do not survive parsing, so this half
     * stays textual — with the line match ANCHORED to a step's `uses:` key,
     * which is what the substring test above it was standing in for.
     */
    it("names the version behind every pin, in a comment", () => {
        for (const path of workflows) {
            for (const line of workflowLines(path)) {
                if (!/^\s*(?:-\s+)?uses:\s/.test(line)) continue;
                if (/^\s*(?:-\s+)?uses:\s+\.\//.test(line)) continue;
                expect(line, `${path}: ${line}`).toMatch(/^\s*(?:-\s+)?uses:\s+\S+\s+#\s*v.+$/);
            }
        }
    });

    it("never uses pull_request_target", () => {
        for (const path of workflows) {
            expect(
                workflowLines(path).join("\n"),
                `${path} must not contain pull_request_target`,
            ).not.toContain("pull_request_target");
        }
    });

    it("keeps permissions read-only outside the explicit write allowlist", () => {
        const actual = workflows.flatMap((path) => permissionWrites(path, workflowText(path)));
        expect([...actual].sort()).toEqual([...WRITE_ALLOWLIST].sort());
    });

    /**
     * Without the flag the token is written into `.git/config` and stays
     * readable to every later step. `ci.yml` claims every checkout sets it,
     * and a claim in this repository becomes an invariant (D100).
     */
    it("never persists the token past checkout", () => {
        const persisting = workflows.flatMap((path) =>
            persistingCheckouts(path, workflowText(path)),
        );
        expect(persisting).toEqual([]);
    });

    it("proves the pin check can fail in both directions", () => {
        const pin = (ref: string): boolean => /^[0-9a-f]{40}$/.test(ref);
        expect(pin("v4")).toBe(false);
        expect(pin("3d3c42e5aac5ba805825da76410c181273ba90b1")).toBe(true);
    });

    const CHECKOUT = "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1";
    const checkoutStep = (step: string): string => `jobs:\n  a:\n    steps:\n      ${step}\n`;

    /**
     * Every row is valid YAML that drops the token, and the last two were read
     * as PERSISTING by the forward line scan this replaced: the quoted value
     * missed its regex, and a flow-mapped step keeps the setting on the same
     * line as `uses:`, ahead of where the scan started looking.
     */
    it.each([
        [
            "an unquoted false",
            `- uses: ${CHECKOUT}\n        with:\n          persist-credentials: false`,
        ],
        [
            "a quoted false",
            `- uses: ${CHECKOUT}\n        with:\n          persist-credentials: "false"`,
        ],
        ["a flow-mapped step", `- { uses: ${CHECKOUT}, with: { persist-credentials: false } }`],
    ] as const)("accepts a checkout that drops the token via %s", (_name, step) => {
        expect(persistingCheckouts("w", checkoutStep(step))).toEqual([]);
    });

    /**
     * The other direction, including the one that made the scan report a PASS:
     * a commented-out flag satisfied an unanchored search of the step's lines.
     */
    it.each([
        ["no with: block", `- uses: ${CHECKOUT}`],
        [
            "the flag commented out",
            `- uses: ${CHECKOUT}\n        with:\n          # persist-credentials: false\n          fetch-depth: 0`,
        ],
        [
            "the flag set to true",
            `- uses: ${CHECKOUT}\n        with:\n          persist-credentials: true`,
        ],
    ] as const)("reports a checkout with %s", (_name, step) => {
        expect(persistingCheckouts("w", checkoutStep(step))).toEqual([`w: ${CHECKOUT}`]);
    });

    /**
     * The allowlist comparison guards the workflows that exist; this guards
     * the check itself against the way it regresses — a NEW job whose grant
     * is spelt in a shape the reader never learned. Every row below is valid
     * YAML that GitHub honours, and the first three were invisible to the
     * line scanner this replaced.
     */
    it.each([
        [
            "a block mapping",
            "jobs:\n  a:\n    permissions:\n      contents: write\n",
            ["w:contents"],
        ],
        ["a flow mapping", "jobs:\n  a:\n    permissions: { contents: write }\n", ["w:contents"]],
        ["a quoted value", 'permissions:\n  contents: "write"\n', ["w:contents"]],
        ["the write-all shorthand", "permissions: write-all\n", ["w:write-all"]],
        ["a workflow-level block", "permissions:\n  contents: write\n", ["w:contents"]],
    ] as const)("finds the write granted by %s", (_name, yaml, expected) => {
        expect(permissionWrites("w", yaml)).toEqual(expected);
    });

    it.each([
        ["read", "permissions:\n  contents: read\n"],
        ["none", "permissions:\n  contents: none\n"],
        ["read-all", "permissions: read-all\n"],
        ["an empty block", "permissions: {}\n"],
        ["no permissions key at all", "jobs:\n  a:\n    runs-on: ubuntu-latest\n"],
    ] as const)("reports no write for %s", (_name, yaml) => {
        expect(permissionWrites("w", yaml)).toEqual([]);
    });
});
