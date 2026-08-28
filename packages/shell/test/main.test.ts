/**
 * The composition root run as the real process: `node --import tsx
 * src/main.ts`, an environment, a socket and a SQLite file, with nothing
 * stubbed. Everything main.ts owns is observable from outside it — the
 * refusal to boot without its three variables, the line naming the port
 * and both file paths, and a signed delivery coming back as a persisted
 * report under exactly the store path that line announced.
 *
 * The mocked predecessor replaced node:fs, node:url, all three workspace
 * packages and all three sibling modules, so it could only prove that main
 * calls what main calls. Rewiring the composition would not have failed it.
 *
 * v8 attributes nothing across a spawn, so src/main.ts is excluded from
 * coverage in vitest.config.ts. The Stryker harness below forwards the
 * active mutant into the child and folds its coverage back into the parent,
 * so the process boundary does not make main.ts a mutation blind spot.
 *
 * Every child is killed twice over: a hard timer inside `withShell`, and
 * the wrapper's own `finally`. A boot that never reaches `listen` has to
 * end as a failed wait, never as a wedged run. Every child also binds
 * HOST=127.0.0.1, because a suite that opens a port to the network is a
 * suite that makes the machine ask its operator about it.
 */

import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { signBody, SIGNATURE_HEADER, type Report } from "@hiero-hackers/automation-core";
import { Store } from "@hiero-hackers/automation-store";
import { capture } from "@hiero-hackers/automation-testkit";

const SHELL_DIR = fileURLToPath(new URL("../", import.meta.url));
/** The same `../data/` main.ts resolves, computed one directory over. */
const DATA_DIR = fileURLToPath(new URL("../data/", import.meta.url));

const LOOPBACK = "127.0.0.1";
/** An address no machine owns: bindable nowhere, routable nowhere (RFC 5737). */
const UNBINDABLE = "203.0.113.1";

const SECRET = "main-test-secret";
const OWNER = "owner-sandbox";
const REPO = "automation-sandbox";
const GUID = "83e4273f-dd89-22f4-92bc-5da478ed1a69";
const UNREADABLE_GUID = "83e4273f-dd89-22f4-92bc-5da478ed1a6a";
const FIXTURE = capture("issues.opened.json").bytes();

const MISSING_VARIABLES =
    "WEBHOOK_SECRET, REPO_OWNER and REPO_NAME are required (the sandbox App's secret and the repository this endpoint serves).";

const CONFIG = `schemaVersion: 1
mode: dry-run
capabilities:
  intake:
    enabled: true
    settings:
      announce: true
mappings:
  labels:
    awaitingTriage: "status: triage"
`;

/** Everything main.ts reads, cleared from the inherited environment. */
const SHELL_VARIABLES = [
    "WEBHOOK_SECRET",
    "REPO_OWNER",
    "REPO_NAME",
    "CONFIG_FILE",
    "APP_ID",
    "PRIVATE_KEY_PATH",
    "INSTALLATION_ID",
    "STORE_PATH",
    "PORT",
    "HOST",
    "KILL_SWITCH",
];

/** Longer than any boot, shorter than the per-test timeout below it. */
const HARD_TIMEOUT_MS = 10_000;
const WAIT_TIMEOUT_MS = 9_000;
const TEST_TIMEOUT_MS = 15_000;

/** One spawned shell, observed only through what the process emits. */
interface Shell {
    stdout(): string;
    stderr(): string;
    /**
     * The exit code, or `null` when a signal ended it. Settled on 'close',
     * so anything awaiting it reads stdout and stderr complete.
     */
    readonly exit: Promise<number | null>;
    /** Settled in the same sense: gone, and its output all here. */
    exited(): boolean;
}

async function until<T>(probe: () => T | undefined, what: string): Promise<T> {
    const deadline = Date.now() + WAIT_TIMEOUT_MS;
    for (;;) {
        const value = probe();
        if (value !== undefined) return value;
        if (Date.now() >= deadline) throw new Error(`timed out waiting for ${what}`);
        await new Promise<void>((resolve) => {
            setTimeout(resolve, 25);
        });
    }
}

// ─── Carrying mutation testing across the spawn ──────────────────────

/**
 * Stryker runs in the process that runs the suite; this suite's subject
 * runs in another one. Two things have to cross that boundary, and
 * neither does on its own.
 *
 * Outward: the active mutant is named in a global here, and instrumented
 * code reads `__STRYKER_ACTIVE_MUTANT__` when its own global is empty. So
 * the variable is handed down. Without it every child runs unmutated code
 * and main.ts scores as perfectly tested while proving nothing.
 *
 * Homeward: mutant coverage is recorded in the child's global, and a
 * mutant that no test is recorded as reaching is never run at all — it is
 * reported "NoCoverage" and counted against the score exactly like a
 * survivor. So the child writes its coverage out as it dies, and the
 * counts are folded into what this test is recorded as covering.
 *
 * The homeward half looks like it should be a config fact instead —
 * `coverageAnalysis: "off"` would run every mutant against every test and
 * no fold would be needed. It was tried: the vitest runner ignores the
 * setting and analyses per test regardless, so main.ts came back 40×
 * NoCoverage and the gate broke at 76%. The fold is the only route.
 *
 * Both halves are inert outside a mutation run: `__stryker__` is only
 * there when Stryker put it there.
 */
interface MutantCoverage {
    static: Record<string, number>;
    perTest: Record<string, Record<string, number>>;
}

interface StrykerNamespace {
    activeMutant?: string;
    currentTestId?: string;
    mutantCoverage?: MutantCoverage;
}

/** Loaded into the child before main.ts, to write what it reached. */
const COVERAGE_HOOK = `import { writeFileSync } from "node:fs";
const flush = () => {
    writeFileSync(
        process.env.SHELL_COVERAGE_OUT,
        JSON.stringify(globalThis.__stryker__?.mutantCoverage ?? null),
    );
};
process.on("exit", flush);
process.stdin.on("end", () => process.exit(0));
process.stdin.resume();
`;

/** Where one child leaves its coverage, and the hook that puts it there. */
interface CoverageDrop {
    readonly dir: string;
    readonly hook: string;
    readonly out: string;
}

function stryker(): StrykerNamespace | undefined {
    return (globalThis as { __stryker__?: StrykerNamespace }).__stryker__;
}

function activeMutant(): Record<string, string> {
    const id = stryker()?.activeMutant;
    return id === undefined ? {} : { __STRYKER_ACTIVE_MUTANT__: String(id) };
}

/** Only the run that measures coverage — never a mutant run — needs one. */
function coverageDrop(): CoverageDrop | undefined {
    const namespace = stryker();
    if (namespace === undefined || namespace.activeMutant !== undefined) return undefined;
    const dir = mkdtempSync(join(tmpdir(), "shell-main-coverage-"));
    const hook = join(dir, "coverage-hook.mjs");
    writeFileSync(hook, COVERAGE_HOOK);
    return { dir, hook, out: join(dir, "coverage.json") };
}

function absorbCoverage(drop: CoverageDrop): void {
    const namespace = stryker();
    const testId = namespace?.currentTestId;
    try {
        if (namespace === undefined || testId === undefined) return;
        const child = JSON.parse(readFileSync(drop.out, "utf8")) as MutantCoverage | null;
        if (child === null) return;
        const coverage = (namespace.mutantCoverage ??= { static: {}, perTest: {} });
        const reached = (coverage.perTest[testId] ??= {});
        for (const [id, hits] of Object.entries(child.static)) {
            reached[id] = (reached[id] ?? 0) + hits;
        }
    } catch {
        // No drop file: the child died before the hook could write one,
        // which only a mutant another case already fails on can do.
    } finally {
        rmSync(drop.dir, { recursive: true, force: true });
    }
}

/**
 * Boot `src/main.ts` for the duration of `body`, then take it down.
 *
 * The parent environment is inherited rather than replaced — it carries
 * the module resolution the child needs — and only the shell's own
 * variables are set from scratch, so a host that exports WEBHOOK_SECRET
 * cannot quietly satisfy the case that requires it to be absent.
 */
async function withShell<T>(
    overrides: Readonly<Record<string, string>>,
    body: (shell: Shell) => Promise<T>,
    preload?: string,
): Promise<T> {
    const environment = { ...process.env };
    for (const key of SHELL_VARIABLES) delete environment[key];
    const drop = coverageDrop();
    const child = spawn(
        process.execPath,
        [
            "--import",
            "tsx",
            ...(drop === undefined ? [] : ["--import", pathToFileURL(drop.hook).href]),
            ...(preload === undefined ? [] : ["--import", pathToFileURL(preload).href]),
            "src/main.ts",
        ],
        {
            cwd: SHELL_DIR,
            env: {
                ...environment,
                ...activeMutant(),
                ...(drop === undefined ? {} : { SHELL_COVERAGE_OUT: drop.out }),
                ...overrides,
            },
        },
    );

    let out = "";
    let error = "";
    let done = false;
    let code: number | null = null;
    let failure: Error | undefined;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
        out += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
        error += chunk;
    });
    // 'exit' carries the code but can arrive with pipe data still in flight;
    // 'close' is the one that means the pipes are drained. So the code is
    // taken from the first and the shell counts as settled on the second,
    // and an assertion on stderr after a wait cannot read half of it.
    child.on("exit", (status) => {
        code = status;
    });
    const exit = new Promise<number | null>((resolve) => {
        child.on("close", () => {
            done = true;
            resolve(code);
        });
        // A spawn that never starts emits 'error' and neither of those two:
        // without this the wait in the finally below settles on nothing but
        // the vitest timeout, and takes the coverage drop down with it.
        child.on("error", (spawnFailure) => {
            failure = spawnFailure;
            done = true;
            resolve(code);
        });
    });
    const hardKill = setTimeout(() => child.kill("SIGKILL"), HARD_TIMEOUT_MS);
    hardKill.unref();

    try {
        return await body({
            stdout: () => out,
            stderr: () => error,
            exit,
            exited: () => done,
        });
    } finally {
        clearTimeout(hardKill);
        if (!done) {
            // Windows kills do not run exit hooks. EOF lets coverage flush first.
            if (drop !== undefined) child.stdin.end();
            else child.kill("SIGTERM");
        }
        const lastResort = setTimeout(() => child.kill("SIGKILL"), 2_000);
        lastResort.unref();
        await exit;
        clearTimeout(lastResort);
        if (drop !== undefined) absorbCoverage(drop);
        // Whatever the body made of a child that never ran, this is why.
        if (failure !== undefined) throw failure;
    }
}

/**
 * The three variables main.ts requires, plus the loopback bind every case
 * here uses: a test shell has no business accepting connections from the
 * network, and a wildcard bind asks the operating system to say so.
 */
function bootEnvironment(): Record<string, string> {
    return { WEBHOOK_SECRET: SECRET, REPO_OWNER: OWNER, REPO_NAME: REPO, HOST: LOOPBACK };
}

/** A port nothing holds at the moment the child is told to take it. */
async function freePort(): Promise<number> {
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, LOOPBACK, resolve));
    const { port } = probe.address() as AddressInfo;
    await new Promise<void>((resolve, reject) => {
        probe.close((failure) => (failure ? reject(failure) : resolve()));
    });
    return port;
}

/** The single line main.ts prints once the socket is actually bound. */
async function listeningLine(shell: Shell): Promise<string> {
    return until(() => {
        const end = shell.stdout().indexOf("\n");
        if (end !== -1) return shell.stdout().slice(0, end);
        if (shell.exited()) throw new Error(`the shell exited before listening: ${shell.stderr()}`);
        return undefined;
    }, "the listening line");
}

async function post(
    port: number,
    deliveryId: string,
    body: Uint8Array<ArrayBuffer>,
): Promise<number> {
    const response = await fetch(`http://${LOOPBACK}:${String(port)}/`, {
        method: "POST",
        headers: {
            [SIGNATURE_HEADER]: signBody(SECRET, body),
            "x-github-delivery": deliveryId,
            "x-github-event": "issues",
        },
        body,
    });
    await response.arrayBuffer();
    return response.status;
}

/** Only the parts of the shell's canonical record this suite reads. */
interface StoredRecord {
    readonly kind: string;
    readonly deliveryId: string;
    readonly event: string;
    readonly report?: Report;
}

/** A locked database is the child mid-commit — the answer is "not yet". */
function ifUnlocked<T>(read: () => T): T | undefined {
    try {
        return read();
    } catch (failure) {
        if (!/locked|busy/i.test(String(failure))) throw failure;
        return undefined;
    }
}

/** Poll the child's own SQLite file until its report for `deliveryId` lands. */
async function persisted(storeFile: string, deliveryId: string): Promise<StoredRecord> {
    const store = await until(
        () => ifUnlocked(() => new Store(storeFile)),
        `the store at ${storeFile}`,
    );
    try {
        return await until(
            () =>
                ifUnlocked(() => {
                    const row = store
                        .deliveryReports()
                        .find((report) => (report.deliveryId as string) === deliveryId);
                    return row === undefined
                        ? undefined
                        : (JSON.parse(row.reportJson) as StoredRecord);
                }),
            `a persisted report for ${deliveryId}`,
        );
    } finally {
        store.close();
    }
}

function codes(record: StoredRecord): string[] {
    return (record.report?.findings ?? []).map((finding) => finding.code);
}

/** A temporary directory holding the dry-run config and the store. */
async function withPaths<T>(
    body: (paths: { configFile: string; storeFile: string; privateKeyFile: string }) => Promise<T>,
): Promise<T> {
    const dir = mkdtempSync(join(tmpdir(), "shell-main-"));
    const configFile = join(dir, "automations.yml");
    const privateKeyFile = join(dir, "app-private-key.pem");
    writeFileSync(configFile, CONFIG);
    try {
        return await body({ configFile, privateKeyFile, storeFile: join(dir, "shell.sqlite") });
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

/** A child-only fetch double: it proves live composition without network access. */
function writeFetchPreload(path: string, logPath: string, mintStatus = 201): void {
    const configBody = JSON.stringify({
        type: "file",
        encoding: "base64",
        content: Buffer.from(CONFIG).toString("base64"),
        sha: "0123456789abcdef0123456789abcdef01234567",
    });
    writeFileSync(
        path,
        `import { appendFileSync } from "node:fs";
globalThis.fetch = async (input, init = {}) => {
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    appendFileSync(${JSON.stringify(logPath)}, JSON.stringify({
        url: String(input),
        method: init.method ?? "GET",
        authorization: headers.authorization ?? null,
    }) + "\\n");
    if (String(input).includes("/access_tokens")) {
        if (${String(mintStatus)} !== 201) return new Response("{}", { status: ${String(mintStatus)} });
        return new Response(JSON.stringify({
            token: "shell-test-installation-token",
            expires_at: "2099-01-01T00:00:00Z",
            permissions: { issues: "write" },
        }), { status: 201 });
    }
    if (String(input).includes("/contents/automations.yml")) {
        return new Response(${JSON.stringify(configBody)}, { status: 200 });
    }
    return new Response("[]", { status: 200 });
};
`,
    );
}

describe("the sandbox entry point, as a process", () => {
    it.each(["WEBHOOK_SECRET", "REPO_OWNER", "REPO_NAME"])(
        "fails closed and listens for nothing when %s is absent",
        async (missing) => {
            const environment = bootEnvironment();
            delete environment[missing];

            await withShell(environment, async (shell) => {
                await until(
                    () => (shell.exited() || shell.stdout() !== "" ? true : undefined),
                    "the shell to give up",
                );
                expect(shell.stdout()).toBe("");
                expect(await shell.exit).toBe(1);
                expect(shell.stderr().trim()).toBe(MISSING_VARIABLES);
            });
        },
        TEST_TIMEOUT_MS,
    );

    it.each([
        { title: "APP_ID only", credentials: { APP_ID: "1" } },
        { title: "PRIVATE_KEY_PATH only", credentials: { PRIVATE_KEY_PATH: "missing.pem" } },
        { title: "INSTALLATION_ID only", credentials: { INSTALLATION_ID: "1" } },
        {
            title: "APP_ID and PRIVATE_KEY_PATH",
            credentials: { APP_ID: "1", PRIVATE_KEY_PATH: "missing.pem" },
        },
        { title: "APP_ID and INSTALLATION_ID", credentials: { APP_ID: "1", INSTALLATION_ID: "1" } },
        {
            title: "PRIVATE_KEY_PATH and INSTALLATION_ID",
            credentials: { PRIVATE_KEY_PATH: "missing.pem", INSTALLATION_ID: "1" },
        },
    ])(
        "fails closed when $title are present",
        async ({ credentials }) => {
            await withShell(
                {
                    ...bootEnvironment(),
                    ...credentials,
                },
                async (shell) => {
                    await until(
                        () => (shell.exited() || shell.stdout() !== "" ? true : undefined),
                        "the partial credential set to be refused",
                    );
                    expect(shell.stdout()).toBe("");
                    expect(await shell.exit).toBe(1);
                    expect(shell.stderr().trim()).toBe(
                        "APP_ID, PRIVATE_KEY_PATH and INSTALLATION_ID must be provided together to use live GitHub access.",
                    );
                },
            );
        },
        TEST_TIMEOUT_MS,
    );

    it(
        "fails closed when PRIVATE_KEY_PATH names no readable file",
        async () => {
            await withPaths(async ({ privateKeyFile }) => {
                await withShell(
                    {
                        ...bootEnvironment(),
                        APP_ID: "123",
                        PRIVATE_KEY_PATH: privateKeyFile,
                        INSTALLATION_ID: "789",
                    },
                    async (shell) => {
                        await until(
                            () => (shell.exited() || shell.stdout() !== "" ? true : undefined),
                            "the missing private key to be refused",
                        );
                        expect(shell.stdout()).toBe("");
                        expect(await shell.exit).toBe(1);
                        expect(shell.stderr().trim()).toBe(
                            `PRIVATE_KEY_PATH could not be read: ${privateKeyFile}`,
                        );
                    },
                );
            });
        },
        TEST_TIMEOUT_MS,
    );

    it.each([
        {
            title: "composes live config and externals",
            mintStatus: 201,
            failureText: null,
        },
        {
            title: "does not fall back to stubs when mint fails",
            mintStatus: 401,
            failureText: "configuration unavailable",
        },
    ])(
        "$title",
        async ({ mintStatus, failureText }) => {
            await withPaths(async ({ configFile, privateKeyFile, storeFile }) => {
                writeFileSync(configFile, "schemaVersion: 1\nmode: observe\n");
                const { privateKey } = generateKeyPairSync("rsa", {
                    modulusLength: 2048,
                    privateKeyEncoding: { type: "pkcs8", format: "pem" },
                    publicKeyEncoding: { type: "spki", format: "pem" },
                });
                writeFileSync(privateKeyFile, privateKey);
                const fetchLog = `${privateKeyFile}.fetch.log`;
                const preload = `${privateKeyFile}.fetch.mjs`;
                writeFetchPreload(preload, fetchLog, mintStatus);
                const port = await freePort();
                await withShell(
                    {
                        ...bootEnvironment(),
                        APP_ID: "123",
                        PRIVATE_KEY_PATH: privateKeyFile,
                        INSTALLATION_ID: "789",
                        CONFIG_FILE: configFile,
                        STORE_PATH: storeFile,
                        PORT: String(port),
                    },
                    async (shell) => {
                        expect(await listeningLine(shell)).toBe(
                            `shell listening on :${String(port)} for ${OWNER}/${REPO} ` +
                                `(live config from ${OWNER}/${REPO}'s default branch: automations.yml); ` +
                                `canonical reports stored in ${storeFile}`,
                        );
                        expect(await post(port, GUID, FIXTURE)).toBe(202);
                        if (failureText === null) {
                            const decided = await persisted(storeFile, GUID);
                            expect(decided.report?.mode).toBe("dry-run");
                            const requests = readFileSync(fetchLog, "utf8")
                                .trim()
                                .split("\n")
                                .map(
                                    (line) =>
                                        JSON.parse(line) as {
                                            url: string;
                                            method: string;
                                            authorization: string | null;
                                        },
                                );
                            const mint = requests.find((request) =>
                                request.url.endsWith("/app/installations/789/access_tokens"),
                            );
                            const timeline = requests.find(
                                (request) =>
                                    request.method === "GET" && request.url.includes("/timeline"),
                            );
                            const config = requests.find((request) =>
                                request.url.includes("/contents/automations.yml"),
                            );
                            expect(mint).toMatchObject({ method: "POST" });
                            expect(mint?.authorization).toMatch(/^Bearer [^.]+\.[^.]+\.[^.]+$/);
                            expect(timeline).toMatchObject({
                                method: "GET",
                                authorization: "Bearer shell-test-installation-token",
                            });
                            expect(config).toMatchObject({
                                method: "GET",
                                authorization: "Bearer shell-test-installation-token",
                            });
                            expect(new URL(config!.url).search).toBe("");
                        } else {
                            await until(
                                () => (shell.stderr().includes(failureText) ? true : undefined),
                                "the live read failure to release the delivery",
                            );
                            const store = new Store(storeFile);
                            try {
                                expect(store.deliveryReports()).toEqual([]);
                            } finally {
                                store.close();
                            }
                        }
                    },
                    preload,
                );
            });
        },
        TEST_TIMEOUT_MS,
    );

    it(
        "announces where it listens, then turns a signed delivery into that store's report",
        async () => {
            await withPaths(async ({ configFile, storeFile }) => {
                const port = await freePort();
                await withShell(
                    {
                        ...bootEnvironment(),
                        CONFIG_FILE: configFile,
                        STORE_PATH: storeFile,
                        PORT: String(port),
                    },
                    async (shell) => {
                        expect(await listeningLine(shell)).toBe(
                            `shell listening on :${String(port)} for ${OWNER}/${REPO} ` +
                                `(config copy of automations.yml: ${configFile}); ` +
                                `canonical reports stored in ${storeFile}`,
                        );

                        expect(await post(port, GUID, FIXTURE)).toBe(202);
                        const decided = await persisted(storeFile, GUID);
                        expect(decided).toMatchObject({
                            kind: "decision",
                            deliveryId: GUID,
                            event: "issues",
                        });
                        expect(decided.report?.mode).toBe("dry-run");
                        expect(codes(decided)).toEqual([
                            "capabilityExplained",
                            "modeRecordsOnly",
                            "capabilityExplained",
                            "modeRecordsOnly",
                        ]);

                        // An unreadable payload is the one report that has to
                        // name the repository this endpoint was started for.
                        const bytes = Buffer.from("not json");
                        expect(await post(port, UNREADABLE_GUID, bytes)).toBe(202);
                        const unreadable = await persisted(storeFile, UNREADABLE_GUID);
                        expect(codes(unreadable)).toEqual(["payloadNotObject"]);
                        expect(unreadable.report?.repository).toEqual({
                            owner: OWNER,
                            repo: REPO,
                        });
                    },
                );
            });
        },
        TEST_TIMEOUT_MS,
    );

    it(
        "KILL_SWITCH=1 reaches the decision: every write is refused as killSwitch",
        async () => {
            await withPaths(async ({ configFile, storeFile }) => {
                const port = await freePort();
                await withShell(
                    {
                        ...bootEnvironment(),
                        CONFIG_FILE: configFile,
                        STORE_PATH: storeFile,
                        PORT: String(port),
                        KILL_SWITCH: "1",
                    },
                    async (shell) => {
                        await listeningLine(shell);
                        expect(await post(port, GUID, FIXTURE)).toBe(202);

                        const decided = await persisted(storeFile, GUID);
                        expect(decided.kind).toBe("decision");
                        expect(codes(decided)).toEqual(["killSwitch", "killSwitch"]);
                    },
                );
            });
        },
        TEST_TIMEOUT_MS,
    );

    it(
        "binds the HOST it was handed, and dies on an address this machine has not got",
        async () => {
            await withShell({ ...bootEnvironment(), HOST: UNBINDABLE }, async (shell) => {
                await until(
                    () => (shell.exited() || shell.stdout() !== "" ? true : undefined),
                    "the bind to be refused",
                );
                expect(shell.stdout()).toBe("");
                expect(shell.stderr()).toMatch(/EADDRNOTAVAIL/);
            });
        },
        TEST_TIMEOUT_MS,
    );

    it(
        "with only the three required variables it takes :8790 and the data/ paths",
        async () => {
            await withShell(bootEnvironment(), async (shell) => {
                const outcome = await until(
                    () => (shell.exited() || shell.stdout() !== "" ? true : undefined),
                    "the default-port boot",
                );
                expect(outcome).toBe(true);
                // 8790 is machine-wide, and mutation runs boot several
                // sandboxes at once. A child that lost the race names the
                // port it wanted in its own error, which is the claim here.
                if (shell.exited()) {
                    expect(shell.stderr()).toMatch(/EADDRINUSE[^\n]*8790/);
                    return;
                }
                expect(await listeningLine(shell)).toBe(
                    `shell listening on :8790 for ${OWNER}/${REPO} ` +
                        `(config copy of automations.yml: ${DATA_DIR}automations.yml); ` +
                        `canonical reports stored in ${DATA_DIR}shell.sqlite`,
                );
            });
        },
        TEST_TIMEOUT_MS,
    );
});
