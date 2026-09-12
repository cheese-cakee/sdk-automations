/**
 * Several `docs/` tables restate closed vocabularies the code owns — one fact
 * in two places, aimed at a reader who cannot run the compiler that would catch
 * the drift (D83). This file locks the identifier columns and severity groups
 * it names below; explanatory and behavior prose remains review-owned. Where
 * no runtime array exists, a mapped type makes a new code fail to compile until
 * the corresponding documented vocabulary follows (D76).
 *
 * The last describe locks a different kind of documented fact — the commands a
 * contributor is TOLD to run — for the same reason, and lives here rather than
 * in a file of its own now that it is one loop each way.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    MAPPABLE_MEANINGS,
    REPOSITORY_MODES,
    TOP_LEVEL_KEYS,
    type ConfigErrorCode,
} from "@hiero-hackers/automation-core";
import type { RecordOnlyCode, SafetyRefusalCode } from "@hiero-hackers/automation-core";
import { verdictFinding, type Severity } from "@hiero-hackers/automation-core";
import { shippedCapabilities } from "./capabilities.js";
import { readGeneratedBlock, renderCapabilityTable } from "./generated.js";
import {
    docsDir,
    exampleFiles,
    normalizeNewlines,
    repoRoot,
    repositoryFiles,
    workspacePackages,
} from "./repository.js";

const page = (name: string): string => normalizeNewlines(readFileSync(join(docsDir, name), "utf8"));

/**
 * The kinds of record the shell persists for one delivery. `ShellRecord` is a
 * private union rather than an exported vocabulary, so there is nothing to
 * import: this reads the declaration's text, the way every repository check
 * reads another package's file (D85).
 */
function shellRecordKinds(): string[] {
    const source = normalizeNewlines(
        readFileSync(join(repoRoot, "packages/runtime/src/shell/processor.ts"), "utf8"),
    );
    const union = source.split("type ShellRecord =")[1]?.split("\n\n")[0] ?? "";
    return [...union.matchAll(/readonly kind: "([A-Za-z]+)"/g)].map((m) => m[1]!);
}

/** The first backtick-quoted token of each table row in one `## section`. */
function tableCodes(markdown: string, heading: string): string[] {
    const section = markdown.split(/^## /m).find((s) => s.startsWith(heading));
    expect(section, `section "${heading}" exists`).toBeDefined();
    return [...(section ?? "").matchAll(/^\|\s*`([^`\r\n]+)`\s*\|/gm)].map((m) => m[1]!);
}

/** Every backtick-quoted token in a section, for the non-table list. */
function inlineCodes(markdown: string, heading: string): string[] {
    const section = markdown.split(/^## /m).find((s) => s.startsWith(heading));
    expect(section, `section "${heading}" exists`).toBeDefined();
    return [...(section ?? "").matchAll(/`([^`\r\n]+)`/g)].map((m) => m[1]!);
}

describe("documentation parsing", () => {
    it.each(["\n", "\r\n"])("reads tables with %j line endings", (newline) => {
        const markdown = [
            "## Codes",
            "",
            "| Code | Meaning |",
            "| --- | --- |",
            "| `first` | one |",
            "| `second` | two |",
            "| `invented_2` | three |",
            "",
            "## Next",
        ].join(newline);
        expect(tableCodes(normalizeNewlines(markdown), "Codes")).toEqual([
            "first",
            "second",
            "invented_2",
        ]);
    });
});

describe("docs/quickstart.md", () => {
    /**
     * The wording is deliberately unpinned: what is locked is that both entry
     * pages HAVE a banner and that the two agree, so a rewrite lands in both.
     */
    it("carries a banner identical to the index's", () => {
        const banner = (name: string) =>
            page(name)
                .split("\n")
                .filter((l) => l.startsWith(">"))
                .join("\n");
        expect(banner("quickstart.md")).not.toBe("");
        expect(banner("quickstart.md")).toEqual(banner("README.md"));
    });

    it("the index links to every other page", () => {
        const index = page("README.md");
        for (const target of [
            "quickstart.md",
            "capabilities.md",
            "configuration.md",
            "troubleshooting.md",
        ]) {
            expect(index).toContain(`(${target})`);
        }
    });

    /**
     * Both directions: a tested example nobody is pointed at is dead weight,
     * and a link to a renamed file is a 404 in the most-read page.
     */
    it("offers every tested example, and links no phantom ones", () => {
        const quickstart = page("quickstart.md");
        const shipped = exampleFiles();
        const linked = [...quickstart.matchAll(/\]\(examples\/([a-z-]+\.yml)\)/g)]
            .map((m) => m[1]!)
            .sort();
        expect(linked).toEqual(shipped);
    });

    it("its mode table is the mode union, in ladder order", () => {
        expect(tableCodes(page("quickstart.md"), "Choosing a mode")).toEqual([...REPOSITORY_MODES]);
    });
});

describe("docs/configuration.md", () => {
    const doc = page("configuration.md");

    /** Both pages state the exact scope of their locks and disclaim prose coverage. */
    it("states the scope and limit of its drift checks, as does troubleshooting", () => {
        const promises = {
            "configuration.md":
                "The test suite locks this page's closed vocabularies—top-level keys, modes, meanings, and rejection\ncodes—against the code on every commit. Explanatory behavior still requires review.",
            "troubleshooting.md":
                "The test suite locks the code membership and severity grouping on this page against the implementation\non every commit. The plain-language explanations still require review.",
            "capabilities.md":
                "The test suite regenerates the table on this page from the shipped capabilities' own declarations on\nevery commit (`pnpm contracts`). The explanations around it still require review.",
        } as const;
        const unscoped = /every table.{0,80}(code-derived|locked|against the code)/is;

        for (const [name, promise] of Object.entries(promises)) {
            expect(page(name), name).toContain(promise);
            expect(page(name), name).not.toMatch(unscoped);
        }
        expect(unscoped.test("Every table is code-derived and locked against the code.")).toBe(
            true,
        );
    });

    /**
     * The tree claims to be "the entire shape" and is the first thing on the
     * page, so both the claim and its stated count are held to the key list.
     */
    it("the at-a-glance tree shows every key, and states the true count", () => {
        const glance = doc.split("## The file at a glance")[1]?.split(/^## /m)[0] ?? "";
        for (const key of TOP_LEVEL_KEYS) {
            expect(glance, `tree shows ${key}`).toContain(`${key}:`);
        }
        expect(glance).toContain(`${TOP_LEVEL_KEYS.length} top-level keys`);
    });

    // A reference guide's characteristic failure is INCOMPLETENESS, so the
    // definition list is held to the key list the unknown-key rule uses.
    it("defines every top-level key, and invents none", () => {
        const defined = [...doc.matchAll(/^### `([a-zA-Z]+)`$/gm)].map((m) => m[1]!);
        expect(defined).toEqual([...TOP_LEVEL_KEYS]);
    });

    it("gives every key a type and a default, or says it is required", () => {
        for (const key of TOP_LEVEL_KEYS) {
            const section = doc.split(`### \`${key}\``)[1] ?? "";
            const table = section.split("\n\n")[1] ?? "";
            expect(table, `${key} has a definition table`).toContain("| Type |");
            expect(table, `${key} states required-or-default`).toMatch(/\| (Required|Default) \|/);
        }
    });

    it("its mode table matches the modes, and the ladder is in order", () => {
        const ladder = doc.split("| Mode | Reads |")[1]?.split("\n\n")[0] ?? "";
        expect([...ladder.matchAll(/^\| `([a-z-]+)` \|/gm)].map((m) => m[1])).toEqual([
            ...REPOSITORY_MODES,
        ]);
    });

    it("its meanings table is the meanings union, exactly", () => {
        expect(tableCodes(doc, "Label mappings")).toEqual([...MAPPABLE_MEANINGS]);
    });

    /** `ConfigErrorCode` has no runtime array, so the catalogue is a mapped type (D76). */
    it("its error table is the error catalogue, exactly", () => {
        const CATALOGUE: { readonly [K in ConfigErrorCode]: true } = {
            documentUnparseable: true,
            duplicateKey: true,
            notAMapping: true,
            unknownKey: true,
            schemaVersionUnsupported: true,
            modeInvalid: true,
            capabilityNameInvalid: true,
            capabilityEnabledNotBoolean: true,
            capabilityUnknown: true,
            meaningNotMappable: true,
            meaningRequired: true,
            labelInvalid: true,
            labelNotInjective: true,
            commandNotMappable: true,
            commandInvalid: true,
            commandNotInjective: true,
            skillNotMappable: true,
            skillInvalid: true,
            skillNotInjective: true,
            alertInvalid: true,
            alertNotInjective: true,
            typeInvalid: true,
            typeNotInjective: true,
            principalNotAString: true,
        };
        expect(tableCodes(doc, "Every way the file can be wrong").sort()).toEqual(
            Object.keys(CATALOGUE).sort(),
        );
    });
});

describe("docs/capabilities.md", () => {
    const doc = page("capabilities.md");

    /**
     * The table is generated, so the lock is one sentence: the page holds
     * what the shipped folders say, and `pnpm contracts` is the repair. The
     * generic halves — a forged block differs, no markers reads as absent —
     * are proven once in `catalogue-drift.test.ts`.
     */
    it("holds the capability table the shipped folders generate", () => {
        for (const { name, markdown } of renderCapabilityTable()) {
            expect(readGeneratedBlock(doc, name), `run \`pnpm contracts\` — ${name}`).toEqual(
                markdown,
            );
        }
        expect(renderCapabilityTable().map(({ name }) => name)).toEqual(["capabilities"]);
    });

    /** A capability nobody can find on the page is one nobody enables. */
    it("names every shipped capability, in the order the shell runs them", () => {
        const [block] = renderCapabilityTable();
        const rows = [...(block?.markdown ?? "").matchAll(/^\| `([A-Za-z]+)` \|/gm)].map(
            (m) => m[1]!,
        );
        expect(rows).toEqual(shippedCapabilities().map(({ name }) => name));
        expect(rows.length).toBeGreaterThan(0);
    });
});

describe("docs/troubleshooting.md", () => {
    const doc = page("troubleshooting.md");
    const onPurpose = tableCodes(doc, "It did nothing on purpose");
    const needsYou = tableCodes(doc, "It needs something from you");
    const defects = inlineCodes(doc, "It should never happen");

    it("covers every refusal and record-only code, and invents none", () => {
        const EVERY_CODE: {
            readonly [K in SafetyRefusalCode | RecordOnlyCode]: true;
        } = {
            killSwitch: true,
            wrongEntryPoint: true,
            preventiveGateUnavailable: true,
            capabilityDisabled: true,
            permissionMissing: true,
            itemBlocked: true,
            itemClosed: true,
            preconditionStale: true,
            newerHumanChange: true,
            humanOrderingUnknown: true,
            invalidTimestamp: true,
            modeDisabled: true,
            wrongActionClass: true,
            noWarning: true,
            warningRequestMismatch: true,
            invalidDestructivePlan: true,
            graceBelowFloor: true,
            graceRunning: true,
            activityCancelled: true,
            observation: true,
            modeRecordsOnly: true,
        };
        expect([...onPurpose, ...needsYou, ...defects].sort()).toEqual(
            Object.keys(EVERY_CODE).sort(),
        );
    });

    /**
     * The page's grouping is a claim about SEVERITY, and `report/convert.ts`
     * is the authority — so ask it rather than restate its table here.
     */
    const severityOf = (code: string): Severity => {
        const RECORD_ONLY: readonly RecordOnlyCode[] = ["observation", "modeRecordsOnly"];
        const verdict = RECORD_ONLY.includes(code as RecordOnlyCode)
            ? ({ outcome: "record-only", code, reason: "r" } as const)
            : ({ outcome: "refuse", code, reason: "r" } as const);
        return verdictFinding(verdict as Parameters<typeof verdictFinding>[0], {
            kind: "repository",
        }).severity;
    };

    /**
     * The section's claim is "nothing to fix", which is a claim about what a
     * reader must DO — so it is `problem` that must not appear here, and both
     * quiet severities may. `notice` is the common case (nothing happened, and
     * that was intended); `graceRunning` is `info` because something IS
     * happening — the App warned and is waiting out what it announced
     * (grace.md §2) — and a reader still has nothing to fix.
     */
    it("'on purpose' rows never ask a reader to act", () => {
        expect(onPurpose.length).toBeGreaterThan(0);
        for (const code of onPurpose) {
            expect(`${code}:${severityOf(code)}`).not.toBe(`${code}:problem`);
        }
        expect(onPurpose.map(severityOf)).toContain("notice");
        expect(onPurpose.map(severityOf)).toContain("info");
    });

    /**
     * A record kind is not a verdict code, so it reaches none of the tables
     * above and nothing else would notice a new one arriving undocumented —
     * which is how `modeUnsupported` shipped with nowhere to look it up.
     * `decision` is the ordinary outcome and stays out: a reader consults this
     * page only when the App recorded something INSTEAD of deciding.
     */
    it("covers every shell record that is not a decision, and invents none", () => {
        const kinds = shellRecordKinds();
        expect(kinds, "the record union parsed").toContain("decision");
        expect(tableCodes(doc, "It never got as far as deciding").sort()).toEqual(
            kinds.filter((kind) => kind !== "decision").sort(),
        );
    });

    it("'needs you' and 'never happen' rows are all problems", () => {
        expect(needsYou.length).toBeGreaterThan(0);
        expect(defects.length).toBeGreaterThan(0);
        for (const code of [...needsYou, ...defects]) {
            expect(`${code}:${severityOf(code)}`).toBe(`${code}:problem`);
        }
    });
});

/**
 * CI gained `format:check` and no document mentioned it, so a contributor could
 * follow CONTRIBUTING exactly, pass locally, and still go red on push (#94).
 * The reverse is the same bug: a documented command that does not exist sends
 * someone to a failure with no explanation. Both directions are one loop over
 * the same parse, so they are one describe.
 */
describe("every documented pnpm command exists", () => {
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
        readonly name: string;
        readonly scripts: ReadonlySet<string>;
    }

    /** A script name and the package scope pnpm will resolve it against. */
    interface Invocation {
        readonly raw: string;
        readonly script: string;
        readonly selector: string | null;
        readonly recursive: boolean;
    }

    /** Null for anything that runs no workspace script: a builtin, or flags alone. */
    function parseInvocation(invocation: string): Invocation | null {
        const raw = invocation.trim();
        // A GitHub expression carries spaces that are not token breaks.
        const tokens = raw.replace(/\$\{\{(.*?)\}\}/g, (_, e: string) => e.trim()).split(/\s+/);
        let selector: string | null = null;
        let recursive = false;
        let explicitRun = false;

        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i]!;
            if (token === "-r" || token === "--recursive") recursive = true;
            else if (token === "--filter" || token === "-F") selector = tokens[++i] ?? "";
            else if (token.startsWith("--filter=")) selector = token.slice("--filter=".length);
            else if (TAKES_VALUE.has(token)) i++;
            else if (token.startsWith("-")) continue;
            else if (token === "run") explicitRun = true;
            else if (!explicitRun && BUILTIN.has(token)) return null;
            else return { raw, script: token, selector, recursive };
        }
        return null;
    }

    function invocations(text: string): Invocation[] {
        return [...text.matchAll(COMMAND)]
            .map((match) => parseInvocation(match[1]!))
            .filter((command): command is Invocation => command !== null);
    }

    /** Why pnpm would not find this script, or null if it would. */
    function problem(command: Invocation, root: Manifest, workspace: readonly Manifest[]): string {
        const { script, selector, recursive } = command;
        if (selector === null && !recursive) {
            return root.scripts.has(script) ? "" : `root has no script "${script}"`;
        }
        const scoped = selector === null ? workspace : workspace.filter((m) => m.name === selector);
        if (scoped.length === 0) return `filter "${selector}" matches no workspace package`;
        const missing = scoped.filter(({ scripts }) => !scripts.has(script)).map((m) => m.name);
        return missing.length === 0 ? "" : `"${script}" is missing from ${missing.join(", ")}`;
    }

    function manifestAt(path: string): Manifest {
        const file = `${path}/package.json`.replace(/^\.\//, "");
        const json = JSON.parse(readFileSync(join(repoRoot, file), "utf8")) as {
            name?: string;
            scripts?: Record<string, unknown>;
        };
        return { name: json.name ?? path, scripts: new Set(Object.keys(json.scripts ?? {})) };
    }

    const root = manifestAt(".");
    const workspace = workspacePackages().map(manifestAt);
    const instructing = INSTRUCTING.filter((doc) => repositoryFiles().includes(doc)).map((doc) => ({
        doc,
        text: readFileSync(join(repoRoot, doc), "utf8"),
    }));
    const ci = readFileSync(join(repoRoot, ".github/workflows/ci.yml"), "utf8");

    it("finds documents and commands to check", () => {
        expect(instructing.map((d) => d.doc)).toEqual(INSTRUCTING);
        expect(instructing.flatMap((d) => invocations(d.text)).length).toBeGreaterThan(3);
    });

    it("every pnpm command in an instructing document is a real script", () => {
        const unknown = instructing.flatMap(({ doc, text }) =>
            invocations(text)
                .map((command) => ({ command, why: problem(command, root, workspace) }))
                .filter(({ why }) => why !== "")
                .map(({ command, why }) => `${doc} -> pnpm ${command.raw}: ${why}`),
        );
        expect([...new Set(unknown)]).toEqual([]);
    });

    it("the gates CI runs are documented somewhere a contributor reads", () => {
        const documented = new Set(
            instructing.flatMap(({ text }) => invocations(text).map((c) => c.script)),
        );
        const undocumented = invocations(ci)
            .map((c) => c.script)
            .filter((name) => !documented.has(name) && !name.startsWith("test:"));
        expect([...new Set(undocumented)]).toEqual([]);
    });

    it("proves the check can fail", () => {
        const scripts = (text: string) => invocations(text).map((c) => c.script);
        expect(scripts("run `pnpm format:check` before pushing")).toEqual(["format:check"]);
        expect(scripts("run `pnpm -r test` and `pnpm lint`")).toEqual(["test", "lint"]);
        expect(scripts("`pnpm --filter @scope/pkg test:coverage`")).toEqual(["test:coverage"]);
        expect(scripts("`pnpm install --frozen-lockfile`")).toEqual([]);
        expect(scripts("cache: pnpm\n      - run: pnpm lint")).toEqual(["lint"]);
        expect(
            parseInvocation("--filter @hiero-hackers/automation-${{ matrix.package }} test"),
        ).toMatchObject({ script: "test", selector: "@hiero-hackers/automation-matrix.package" });

        const ask = (text: string) => problem(parseInvocation(text)!, root, workspace);
        expect(ask("format:check")).toBe("");
        expect(ask("run no_such.2")).toContain("root has no script");
        expect(ask("--filter @hiero-hackers/automation-core test:coverage")).toBe("");
        expect(ask("--filter @hiero-hackers/automation-checks test:coverage")).toContain(
            "is missing from",
        );
        expect(ask("--filter @hiero-hackers/no-such-package test")).toContain("matches no");
        expect(ask("-r test")).toBe("");
        expect(
            problem(parseInvocation("-r test")!, root, [{ name: "empty", scripts: new Set() }]),
        ).toContain("is missing from");
    });
});
