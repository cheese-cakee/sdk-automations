/**
 * Every package that owns a Stryker config owns a real recursive source scope
 * and a numeric gate, and CI's matrix runs that exact package set. A scope or
 * matrix entry that drifts alone mutates less and still passes (D89's mutate
 * glob).
 *
 * `ci.yml` is read with a YAML parser, not sliced with regexes: a check whose
 * grip depends on where the line breaks fall is the fragility this file exists
 * to remove.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parse } from "yaml";
import { normalizeRepoPath, repoRoot, trackedFiles, workspacePackages } from "./repository.js";

interface StrykerConfig {
    readonly mutate: readonly string[];
    readonly thresholds: { readonly break: unknown };
}

interface ConfiguredPackage {
    readonly name: string;
    readonly path: string;
    readonly config: StrykerConfig;
    readonly sources: readonly string[];
}

interface Job {
    readonly name?: string;
    readonly strategy?: {
        readonly matrix?: Readonly<Record<string, readonly string[] | undefined>>;
    };
    readonly steps?: readonly { readonly run?: string }[];
}

interface Workflow {
    readonly jobs?: Readonly<Record<string, Job | undefined>>;
}

function mutationJob(workflow: string): Job {
    const job = (parse(workflow) as Workflow).jobs?.mutation;
    if (job === undefined) throw new Error("the ci workflow has no mutation job");
    return job;
}

/** The matrix axis CI fans the job out over, in declaration order. */
function matrixPackages(job: Job): string[] {
    return [...(job.strategy?.matrix?.package ?? [])];
}

function runCommands(job: Job): string[] {
    return (job.steps ?? []).map(({ run }) => run ?? "");
}

/** The invocation CI fans out, before the flags that tune how it runs. */
const STRYKER_RUN =
    "pnpm --filter @hiero-hackers/automation-${{ matrix.package }} exec stryker run";

function strykerCommand(job: Job): string | undefined {
    return runCommands(job).find((run) => run.startsWith(STRYKER_RUN));
}

function matrixDrift(
    configured: readonly string[],
    matrix: readonly string[],
): { missing: string[]; extra: string[] } {
    const configuredSet = new Set(configured);
    const matrixSet = new Set(matrix);
    return {
        missing: configured.filter((name) => !matrixSet.has(name)).sort(),
        extra: matrix.filter((name) => !configuredSet.has(name)).sort(),
    };
}

function coverageJob(workflow: string): Job {
    const job = (parse(workflow) as Workflow).jobs?.coverage;
    if (job === undefined) throw new Error("the ci workflow has no coverage job");
    return job;
}

const COVERAGE_RUN = "test:coverage";

function coverageCommand(job: Job): string | undefined {
    return runCommands(job).find((run) => run.includes(COVERAGE_RUN));
}

interface CoveragePackage {
    readonly name: string;
    readonly path: string;
    readonly script: string;
}

const tracked = trackedFiles();
const trackedSet = new Set(tracked);
const configuredPackages: ConfiguredPackage[] = workspacePackages()
    .filter((packagePath) => trackedSet.has(`${packagePath}/stryker.config.json`))
    .map((packagePath) => {
        const configPath = `${packagePath}/stryker.config.json`;
        const config = JSON.parse(
            readFileSync(join(repoRoot, configPath), "utf8"),
        ) as StrykerConfig;
        const prefix = `${packagePath}/`;
        const sources = tracked
            .filter((path) => path.startsWith(`${prefix}src/`) && path.endsWith(".ts"))
            .map((path) => normalizeRepoPath(path.slice(prefix.length)));
        return { name: basename(packagePath), path: packagePath, config, sources };
    });

const coveragePackages: CoveragePackage[] = workspacePackages()
    .filter((packagePath) => {
        const manifestPath = join(repoRoot, packagePath, "package.json");
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
            scripts?: Record<string, string>;
        };
        return typeof manifest.scripts?.["test:coverage"] === "string";
    })
    .map((packagePath) => {
        const manifestPath = join(repoRoot, packagePath, "package.json");
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
            scripts?: Record<string, string>;
        };
        return {
            name: basename(packagePath),
            path: packagePath,
            script: manifest.scripts!["test:coverage"]!,
        };
    });

const workflowContent = readFileSync(join(repoRoot, ".github", "workflows", "ci.yml"), "utf8");
const mutation = mutationJob(workflowContent);
const coverage = coverageJob(workflowContent);

describe("mutation policy stays complete across packages and CI", () => {
    it("discovers every configured workspace package", () => {
        expect(configuredPackages.map(({ name }) => name).sort()).toEqual([
            "adapter",
            "core",
            "probes",
            "shell",
            "store",
        ]);
    });

    /**
     * Two facts: the scope is EXACTLY the recursive glob, and the package has
     * sources for it to reach. Glob semantics are not reimplemented here.
     */
    it("mutates every tracked TypeScript source recursively", () => {
        for (const subject of configuredPackages) {
            expect(subject.config.mutate, subject.path).toEqual(["src/**/*.ts"]);
            expect(subject.sources.length, subject.path).toBeGreaterThan(0);
        }
    });

    it("sets a numeric break threshold in every package policy", () => {
        for (const subject of configuredPackages) {
            expect(typeof subject.config.thresholds.break, subject.path).toBe("number");
        }
    });

    it("runs every configured package independently in the mutation matrix", () => {
        expect(mutation.name).toBe("mutation testing (${{ matrix.package }})");
        expect(strykerCommand(mutation), "no stryker run step in the mutation job").toBeDefined();
        // Only that the run is incremental, not how the `--force` on main is
        // spelled: pinning the GitHub expression would make a rewording of the
        // conditional read as a policy change.
        expect(strykerCommand(mutation)).toContain("--incremental");
        expect(
            matrixDrift(
                configuredPackages.map(({ name }) => name),
                matrixPackages(mutation),
            ),
        ).toEqual({ missing: [], extra: [] });
    });

    it("proves misspelled scopes fail in both directions, and reformatting does not", () => {
        expect(matrixDrift(["core", "shell", "store"], ["core", "shell", "stroe"])).toEqual({
            missing: ["store"],
            extra: ["stroe"],
        });
        // The same matrix as a block sequence, keys reordered, run command
        // folded: the old `package:\s*\[([^\]]+)\]` slice read nothing here
        // and reported the empty result as drift-free.
        const reformatted = mutationJob(
            [
                "jobs:",
                "  mutation:",
                "    strategy:",
                "      matrix:",
                "        package:",
                "          - adapter",
                "          - core",
                "          - probes",
                "          - shell",
                "          - store",
                "    name: mutation testing (${{ matrix.package }})",
                "    steps:",
                "      - run: >-",
                "          pnpm --filter",
                "          @hiero-hackers/automation-${{ matrix.package }} exec stryker run",
                "          --incremental",
                "",
            ].join("\n"),
        );
        expect(matrixPackages(reformatted)).toEqual(matrixPackages(mutation));
        expect(reformatted.name).toBe(mutation.name);
        expect(strykerCommand(reformatted)).toContain("--incremental");
    });
});

describe("coverage policy stays complete across packages and CI", () => {
    it("discovers every package owning a test:coverage script", () => {
        expect(coveragePackages.map(({ name }) => name).sort()).toEqual([
            "adapter",
            "core",
            "probes",
            "shell",
            "store",
        ]);
    });

    it("runs every coverage-configured package in the coverage matrix", () => {
        expect(coverage.name).toBe("line coverage (${{ matrix.package }})");
        expect(
            coverageCommand(coverage),
            "no test:coverage run step in coverage job",
        ).toBeDefined();
        expect(
            matrixDrift(
                coveragePackages.map(({ name }) => name),
                matrixPackages(coverage),
            ),
        ).toEqual({ missing: [], extra: [] });
    });

    it("proves missing, extra, or misspelled coverage matrix packages fail", () => {
        const configured = coveragePackages.map(({ name }) => name);
        expect(matrixDrift(configured, ["adapter", "core", "shell", "store"])).toEqual({
            missing: ["probes"],
            extra: [],
        });
        expect(
            matrixDrift(configured, ["adapter", "core", "probes", "shell", "store", "checks"]),
        ).toEqual({
            missing: [],
            extra: ["checks"],
        });
        expect(matrixDrift(configured, ["adapter", "core", "probes", "shlel", "store"])).toEqual({
            missing: ["shell"],
            extra: ["shlel"],
        });
    });
});
