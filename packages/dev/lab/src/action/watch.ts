/**
 * Watching the Action's runs from outside: which runs a step raised and whether they have
 * settled, what their logs say, an item's timeline, and a re-run of an old run. Every log
 * and run link read is kept in the protocol's evidence.
 */

import type { ItemRef } from "@hiero-hackers/automation-core";
import { field, Halt, listOf, type Call } from "../github.js";
import type { LogRow, TimelineEvent } from "./judge.js";
import type { Evidence } from "./record.js";
import { parseLog, runsRaised, settlementOf, type RunReader, type WorkflowRun } from "./runs.js";

const POLL_MS = 15_000;

const STEP_DEADLINE_MS = 10 * 60_000;

/** More runs than one protocol can raise on its own. */
const RUN_CEILING = 400;

const PAGE = 100;

export type Settled =
    | { readonly runs: WorkflowRun[]; readonly cancelled: WorkflowRun[] }
    | { readonly failed: string };

export interface Reading {
    readonly rows: LogRow[];
    readonly malformed: string[];
    readonly engine: string | null;
    readonly texts: string[];
}

/** The engine commit the logs must name, checked as each log is read. */
export interface EngineGuard {
    verify(engine: string | null): void;
}

export function createEngineGuard(expected: string | null): EngineGuard {
    let seen = false;
    return {
        verify(engine) {
            if (expected === null) return;
            if (engine === null) {
                if (!seen) throw new Halt("the first run's log names no engine commit");
                return;
            }
            if (engine !== expected) {
                throw new Halt(`the engine commit in the log is ${engine}, not ${expected}`);
            }
            seen = true;
        },
    };
}

export interface Watch {
    /** The runs a step raised once they have settled; `tolerate` conclusions do not fail it. */
    settle(
        since: string,
        raises: readonly string[],
        tolerate?: readonly string[],
    ): Promise<Settled>;
    /** Reads and keeps the logs of the runs; the rows, the engine, the texts. */
    read(runs: readonly Pick<WorkflowRun, "id">[], suffix?: string): Promise<Reading>;
    timeline(item: ItemRef): Promise<TimelineEvent[]>;
    /** The runs of those events raised after waiting `ms`: none is the expected answer. */
    quiet(since: string, raises: readonly string[], ms: number): Promise<WorkflowRun[]>;
    /** Re-runs a run and waits for the new attempt; answers when the re-run began. */
    rerun(runId: number): Promise<string>;
}

export interface WatchOptions {
    readonly call: Call;
    readonly reader: RunReader;
    readonly evidence: Evidence;
    readonly guard: EngineGuard;
    readonly owner: string;
    readonly repo: string;
    readonly sleep: (ms: number) => Promise<void>;
}

export function createWatch(options: WatchOptions): Watch {
    const { call, reader, evidence, guard, owner, repo, sleep } = options;
    const claimed = new Set<number>();
    const ignored = new Set<number>();
    const link = (id: number): string =>
        `https://github.com/${owner}/${repo}/actions/runs/${String(id)}`;

    return {
        async settle(since, raises, tolerate = []) {
            let held = "";
            let heldSince = Date.now();
            for (const deadline = Date.now() + STEP_DEADLINE_MS; Date.now() < deadline;) {
                await sleep(POLL_MS);
                const listed = await reader.listSince(since);
                for (const run of listed) {
                    if (claimed.has(run.id) || ignored.has(run.id) || raises.includes(run.event))
                        continue;
                    ignored.add(run.id);
                    evidence.record("ignored", { run });
                }
                const all = runsRaised(listed, since, raises, claimed);
                const cancelled = all.filter((run) => tolerate.includes(run.conclusion ?? ""));
                const runs = all.filter((run) => !cancelled.includes(run));
                const ids = all.map((run) => run.id).join(",");
                if (ids !== held) {
                    held = ids;
                    heldSince = Date.now();
                }
                const settlement = settlementOf(runs, Date.now() - heldSince);
                if (settlement.kind === "failed") return { failed: settlement.reason };
                if (settlement.kind === "settled") {
                    for (const run of all) claimed.add(run.id);
                    if (claimed.size > RUN_CEILING)
                        throw new Halt(`more than ${String(RUN_CEILING)} runs`);
                    for (const run of all)
                        evidence.append(
                            "runs.txt",
                            `${link(run.id)} ${run.event} ${run.conclusion ?? ""}`,
                        );
                    return { runs, cancelled };
                }
            }
            return { failed: `no settled run within ${String(STEP_DEADLINE_MS)} ms` };
        },

        async read(runs, suffix = "") {
            const rows: LogRow[] = [];
            const malformed: string[] = [];
            const texts: string[] = [];
            let engine: string | null = null;
            for (const run of runs) {
                const text = await reader.jobLogs(run.id);
                evidence.write(`run-${String(run.id)}${suffix}.log`, text);
                const parsed = parseLog(text);
                rows.push(...parsed.rows);
                malformed.push(...parsed.malformed);
                texts.push(text);
                engine ??= parsed.engineCommit;
                evidence.record("log", { run: run.id, ...parsed });
            }
            guard.verify(engine);
            return { rows, malformed, engine, texts };
        },

        async timeline(item) {
            const base = `/repos/${owner}/${repo}/issues/${String(item.number)}`;
            const events = listOf(
                await call("GET", `${base}/timeline?per_page=${String(PAGE)}`),
                "the timeline",
            );
            if (events.length >= PAGE) {
                throw new Halt(`${item.kind}#${String(item.number)} has a page of events or more`);
            }
            const login = (entry: unknown): string | null => {
                const actor =
                    field(field(entry, "actor"), "login") ?? field(field(entry, "user"), "login");
                return typeof actor === "string" ? actor : null;
            };
            const text = (entry: unknown, ...names: string[]): string | null => {
                const held = names
                    .map((name) => field(entry, name))
                    .find((value) => typeof value === "string");
                return typeof held === "string" ? held : null;
            };
            const timeline = events.map((entry) => ({
                event: String(field(entry, "event")),
                actor: login(entry),
                at: text(entry, "created_at", "submitted_at"),
                label: text(field(entry, "label"), "name"),
            }));
            evidence.write(
                `timeline-${item.kind}-${String(item.number)}.json`,
                JSON.stringify(events, null, 2),
            );
            return timeline;
        },

        async quiet(since, raises, ms) {
            await sleep(ms);
            return runsRaised(await reader.listSince(since), since, raises, new Set());
        },

        async rerun(runId) {
            const before = (await reader.attemptOf(runId)).attempt;
            const answer = await call(
                "POST",
                `/repos/${owner}/${repo}/actions/runs/${String(runId)}/rerun`,
                {
                    accept: [201],
                },
            );
            const since = answer.date ?? new Date().toISOString();
            for (const deadline = Date.now() + STEP_DEADLINE_MS; Date.now() < deadline;) {
                await sleep(POLL_MS);
                const now = await reader.attemptOf(runId);
                if (now.attempt > before && now.completed) {
                    evidence.append("runs.txt", `${link(runId)} attempt ${String(now.attempt)}`);
                    return since;
                }
            }
            throw new Halt(`run ${String(runId)} did not finish its re-run`);
        },
    };
}
