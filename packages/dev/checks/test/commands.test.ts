/**
 * Every `pnpm` command a contributor is told to run exists as a script. CI
 * gained `format:check` and no document mentioned it, so a contributor could
 * follow CONTRIBUTING exactly, pass locally, and still go red on push (#94).
 * The reverse is the same bug: a documented command that does not exist sends
 * someone to a failure with no explanation. One invariant per file (D89).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, trackedFiles, workspacePackages } from "./repository.js";

/** The documents that instruct a human. Not `design/` — that explains, it does not instruct. */
const INSTRUCTING = ["CONTRIBUTING.md", "README.md"];

/**
 * One `pnpm …` invocation, to the end of its code span or line. Horizontal
 * whitespace only: `\s` crosses newlines, so `cache: pnpm` followed by the
 * next line's `- run:` read as a command named `run:`.
 */
const COMMAND = /pnpm[ \t]+([^\n`]*)/g;

/** Flags that swallow the token after them, so it is never the script name. */
const TAKES_VALUE = new Set(["--dir", "-C"]);

/** pnpm's own subcommands, which need no script to exist. */
const BUILTIN = new Set(["install", "add", "remove", "why", "dlx", "exec", "store", "audit"]);

interface Manifest {
    readonly path: string;
    readonly name: string;
    readonly scripts: ReadonlySet<string>;
}

type CommandScope =
    | { readonly kind: "root" }
    | { readonly kind: "recursive" }
    | { readonly kind: "filter"; readonly selector: string };

interface PnpmInvocation {
    readonly raw: string;
    readonly script: string | null;
    readonly scope: CommandScope;
}

/** Parse the script and the package scope that pnpm will resolve it against. */
export function parseInvocation(invocation: string): PnpmInvocation | null {
    // Keep a GitHub expression with internal spaces attached to the filter
    // token around it, e.g. `automation-${{ matrix.package }}` in CI.
    const tokens = invocation.trim().match(/\S*\$\{\{.*?\}\}\S*|\S+/g) ?? [];
    let recursive = false;
    let selector: string | null = null;
    let explicitRun = false;

    const scope = (): CommandScope =>
        selector !== null
            ? { kind: "filter", selector }
            : recursive
              ? { kind: "recursive" }
              : { kind: "root" };

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i]!;
        if (token === "-r" || token === "--recursive") {
            recursive = true;
            continue;
        }
        if (token === "--filter" || token === "-F") {
            selector = tokens[++i] ?? "";
            continue;
        }
        if (token.startsWith("--filter=")) {
            selector = token.slice("--filter=".length);
            continue;
        }
        if (TAKES_VALUE.has(token)) {
            i++;
            continue;
        }
        if (token.startsWith("-")) continue;
        if (token === "run") {
            explicitRun = true;
            continue;
        }
        if (!explicitRun && BUILTIN.has(token)) {
            return { raw: invocation.trim(), script: null, scope: scope() };
        }
        return { raw: invocation.trim(), script: token, scope: scope() };
    }
    return null;
}

function manifestAt(path: string): Manifest {
    const manifest = `${path}/package.json`.replace(/^\.\//, "");
    const json = JSON.parse(readFileSync(join(repoRoot, manifest), "utf8")) as {
        name?: string;
        scripts?: Record<string, unknown>;
    };
    return {
        path,
        name: json.name ?? path,
        scripts: new Set(Object.keys(json.scripts ?? {})),
    };
}

function commandProblem(
    command: PnpmInvocation,
    root: Manifest,
    workspace: readonly Manifest[],
): string | null {
    if (command.script === null) return null;
    const { script } = command;

    if (command.scope.kind === "root") {
        return root.scripts.has(script) ? null : `root has no script "${script}"`;
    }
    if (command.scope.kind === "recursive") {
        const missing = workspace
            .filter(({ scripts }) => !scripts.has(script))
            .map(({ name }) => name);
        return missing.length === 0
            ? null
            : `recursive script "${script}" is missing from ${missing.join(", ")}`;
    }

    const { selector } = command.scope;
    const selected = workspace.filter(({ name }) => name === selector);
    if (selected.length === 0) return `filter "${selector}" matches no workspace package`;
    const missing = selected.filter(({ scripts }) => !scripts.has(script)).map(({ name }) => name);
    return missing.length === 0
        ? null
        : `filtered script "${script}" is missing from ${missing.join(", ")}`;
}

function invocations(text: string): PnpmInvocation[] {
    return [...text.matchAll(COMMAND)]
        .map((match) => parseInvocation(match[1]!))
        .filter((command): command is PnpmInvocation => command !== null);
}

export function documentedCommands(text: string): string[] {
    return invocations(text)
        .map(({ script }) => script)
        .filter((script): script is string => script !== null);
}

describe("every documented pnpm command exists", () => {
    const root = manifestAt(".");
    const workspace = workspacePackages().map(manifestAt);
    const docs = INSTRUCTING.filter((d) => trackedFiles().includes(d)).map((doc) => ({
        doc,
        text: readFileSync(join(repoRoot, doc), "utf8"),
    }));

    it("finds documents and commands to check", () => {
        expect(docs.length).toBe(INSTRUCTING.length);
        expect(docs.flatMap((d) => documentedCommands(d.text)).length).toBeGreaterThan(3);
    });

    it("every pnpm command in an instructing document is a real script", () => {
        const unknown: string[] = [];
        for (const { doc, text } of docs) {
            for (const command of invocations(text)) {
                const problem = commandProblem(command, root, workspace);
                if (problem !== null) unknown.push(`${doc} -> pnpm ${command.raw}: ${problem}`);
            }
        }
        expect([...new Set(unknown)]).toEqual([]);
    });

    it("the gates CI runs are documented somewhere a contributor reads", () => {
        const documented = new Set(docs.flatMap((d) => documentedCommands(d.text)));
        const ciText = readFileSync(join(repoRoot, ".github/workflows/ci.yml"), "utf8");
        const inCi = new Set(documentedCommands(ciText));
        const undocumented = [...inCi].filter(
            (name) => !documented.has(name) && !name.startsWith("test:"),
        );
        expect(undocumented).toEqual([]);
    });

    it("proves the check can fail", () => {
        expect(documentedCommands("run `pnpm format:check` before pushing")).toEqual([
            "format:check",
        ]);
        expect(documentedCommands("run `pnpm -r test` and `pnpm lint`")).toEqual(["test", "lint"]);
        expect(documentedCommands("`pnpm --filter @scope/pkg test:coverage`")).toEqual([
            "test:coverage",
        ]);
        expect(documentedCommands("`pnpm install --frozen-lockfile`")).toEqual([]);
        expect(documentedCommands("cache: pnpm\n      - run: pnpm lint")).toEqual(["lint"]);
        expect(commandProblem(parseInvocation("format:check")!, root, workspace)).toBeNull();
        expect(commandProblem(parseInvocation("no-such-script")!, root, workspace)).toContain(
            "root has no script",
        );
        expect(commandProblem(parseInvocation("run no_such.2")!, root, workspace)).toContain(
            "root has no script",
        );

        expect(
            commandProblem(
                parseInvocation("--filter @hiero-hackers/automation-core test:coverage")!,
                root,
                workspace,
            ),
        ).toBeNull();
        expect(
            commandProblem(
                parseInvocation("--filter @hiero-hackers/automation-checks test:coverage")!,
                root,
                workspace,
            ),
        ).toContain("filtered script");
        expect(
            parseInvocation(
                "--filter @hiero-hackers/automation-${{ matrix.package }} test:coverage",
            ),
        ).toMatchObject({
            script: "test:coverage",
            scope: {
                kind: "filter",
                selector: "@hiero-hackers/automation-${{ matrix.package }}",
            },
        });
        expect(
            commandProblem(
                parseInvocation("--filter @hiero-hackers/no-such-package test")!,
                root,
                workspace,
            ),
        ).toContain("matches no workspace package");

        expect(commandProblem(parseInvocation("-r test")!, root, workspace)).toBeNull();
        const oneMissingTest = workspace.map((manifest, index) =>
            index === 0 ? { ...manifest, scripts: new Set<string>() } : manifest,
        );
        expect(commandProblem(parseInvocation("-r test")!, root, oneMissingTest)).toContain(
            "recursive script",
        );
    });
});
