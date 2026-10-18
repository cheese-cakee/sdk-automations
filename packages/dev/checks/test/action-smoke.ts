/**
 * The bundle as a repository runs it: `node dist/action.js` once per captured delivery and once
 * on the schedule against the fake GitHub, then under its three switches. A run that is not as
 * a consumer would see it fails this script by name. `pnpm smoke:action` builds and runs it.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
    startFakeGitHub,
    WEBHOOK_CAPTURES,
    type FakeGitHub,
    type GitHubCall,
} from "@hiero-hackers/automation-testkit";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const bundle = join(repoRoot, "packages", "runtime", "dist", "action.js");
const FULL = readFileSync(join(repoRoot, "docs", "examples", "full.yml"), "utf8");
const REPOSITORY = "scrubbed-1/scrubbed-2";

interface Run {
    readonly name: string;
    readonly event: string;
    readonly repository: string;
    readonly payload: string | Uint8Array;
    readonly arm?: boolean;
}

interface Result {
    readonly status: number | null;
    readonly stdout: string;
    readonly stderr: string;
    readonly summary: string;
    /** What the fake was asked during this run alone. */
    readonly calls: readonly GitHubCall[];
}

/** A call that would change the repository: anything but a read or the GraphQL query. */
const isWrite = (call: GitHubCall): boolean =>
    call.method !== "GET" && !call.path.endsWith("/graphql");

/** The environment the runner sets, with action.yml's defaults for the inputs. The child runs
 * while this process keeps serving as the fake, so it is spawned, never spawned synchronously. */
async function runOnce(fake: FakeGitHub, run: Run): Promise<Result> {
    const dir = mkdtempSync(join(tmpdir(), "action-smoke-"));
    const before = fake.calls.length;
    try {
        const eventPath = join(dir, "event.json");
        const summaryPath = join(dir, "summary.md");
        writeFileSync(eventPath, run.payload);
        writeFileSync(summaryPath, "");
        const child = spawn(process.execPath, [bundle], {
            stdio: ["ignore", "pipe", "pipe"],
            timeout: 120_000,
            env: {
                PATH: process.env["PATH"] ?? "",
                GITHUB_REPOSITORY: run.repository,
                GITHUB_EVENT_NAME: run.event,
                GITHUB_EVENT_PATH: eventPath,
                GITHUB_RUN_ID: "1",
                GITHUB_RUN_ATTEMPT: "1",
                GITHUB_SERVER_URL: "https://github.com",
                GITHUB_API_URL: fake.origin,
                GITHUB_STEP_SUMMARY: summaryPath,
                INPUT_TOKEN: "smoke-token",
                "INPUT_ARM-WRITES": run.arm === true ? "true" : "false",
                "INPUT_BOT-LOGIN": "github-actions[bot]",
                "INPUT_APP-ID": "15368",
            },
        });
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
        child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
        const status = await new Promise<number | null>((resolve) => child.on("close", resolve));
        return {
            status,
            stdout,
            stderr,
            summary: readFileSync(summaryPath, "utf8"),
            calls: fake.calls.slice(before),
        };
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

/** What every run must show, and whether it may have written; the failures as sentences. */
function expectations(
    result: Result,
    run: Run,
    status: number,
    writes: "none" | "attempted",
    ...needles: readonly string[]
): string[] {
    const faults: string[] = [];
    if (result.status !== status) {
        faults.push(`exited ${String(result.status)}, not ${String(status)}`);
    }
    const heading = `## ${run.repository}: ${run.event} (`;
    if (!result.summary.startsWith(heading))
        faults.push(`the summary does not open with ${heading}`);
    const written = result.calls.filter(isWrite);
    if (writes === "none" && written.length > 0) {
        faults.push(`wrote: ${written.map((call) => `${call.method} ${call.path}`).join(", ")}`);
    }
    if (writes === "attempted" && written.length === 0) faults.push("attempted no write");
    const seen = `${result.stdout}\n${result.stderr}\n${result.summary}`;
    for (const needle of needles) {
        if (!seen.includes(needle)) faults.push(`nowhere says ${needle}`);
    }
    return faults;
}

function capturedRun(name: string): Run {
    const held = WEBHOOK_CAPTURES.find((candidate) => candidate.name === name);
    if (held === undefined) throw new Error(`no capture named ${name}`);
    const payload = held.json() as { repository: { full_name: string } };
    return {
        name,
        event: held.event,
        repository: payload.repository.full_name,
        payload: held.bytes(),
    };
}

const schedule: Run = {
    name: "schedule",
    event: "schedule",
    repository: REPOSITORY,
    payload: JSON.stringify({
        schedule: "0 * * * *",
        repository: { full_name: REPOSITORY, name: "scrubbed-2", owner: { login: "scrubbed-1" } },
    }),
};

const fake = await startFakeGitHub({ now: () => new Date(), config: () => FULL });
const failures: string[] = [];
const report = (name: string, result: Result, faults: readonly string[]): void => {
    const summary = result.summary.replace(/^/gm, "      ");
    if (faults.length === 0) {
        console.log(`ok    ${name}\n${summary}`);
        return;
    }
    failures.push(name);
    console.log(`FAIL  ${name}: ${faults.join("; ")}\n${summary}`);
    console.log(result.stdout);
    console.log(result.stderr);
};

try {
    for (const held of WEBHOOK_CAPTURES) {
        const run = capturedRun(held.name);
        const result = await runOnce(fake, run);
        report(
            run.name,
            result,
            expectations(
                result,
                run,
                0,
                "none",
                '"event":"deliveryCompleted"',
                '"kind":"decision"',
                "(delivery)",
            ),
        );
    }
    const swept = await runOnce(fake, schedule);
    report(
        schedule.name,
        swept,
        expectations(swept, schedule, 0, "none", '"event":"sweepClaimed"', "(sweep)"),
    );

    const opened = capturedRun("issues.opened.json");
    fake.noConfig(true);
    const unconfigured = await runOnce(fake, opened);
    fake.noConfig(false);
    report(
        "no configuration file",
        unconfigured,
        expectations(
            unconfigured,
            opened,
            0,
            "none",
            "No `sdk-automations.yml` at the default branch",
            "::warning::No `sdk-automations.yml`",
        ),
    );

    fake.setConfig(FULL.replace("mode: dry-run", "mode: active"));
    const lowered = await runOnce(fake, opened);
    report(
        "active, writes not armed",
        lowered,
        expectations(
            lowered,
            opened,
            0,
            "none",
            "::notice::The configuration asked for `active`",
            "(delivery)",
        ),
    );
    fake.refuseWrites(true);
    const forbidden = await runOnce(fake, { ...opened, arm: true });
    fake.refuseWrites(false);
    fake.setConfig(FULL);
    report(
        "a write the token may not make",
        forbidden,
        expectations(forbidden, opened, 0, "attempted", "refused writeForbidden", "::warning::"),
    );

    fake.secondaryLimit(true, 1);
    const limited = await runOnce(fake, opened);
    fake.secondaryLimit(false);
    report(
        "a secondary rate limit",
        limited,
        expectations(
            limited,
            opened,
            1,
            "none",
            "The run exited non-zero: `deliveryAttemptFailed`",
            "::warning::deliveryAttemptFailed",
        ),
    );
} finally {
    await fake.close();
}

if (failures.length > 0) {
    console.log(`\n${String(failures.length)} smoke run(s) failed: ${failures.join(", ")}`);
    process.exit(1);
}
console.log(`\nevery smoke run passed; the fake answered ${String(fake.calls.length)} calls`);
