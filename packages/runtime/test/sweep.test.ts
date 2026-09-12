/**
 * The sweep, from a due schedule row to one decision per open item.
 *
 * Two halves. The first drives the driver against a SCRIPTED reader, because
 * what the driver owns is order and honesty — pull requests before issues, the
 * inverse links built from their reads, one decision per record, the next
 * firing armed whatever happened — and a scripted reader is the only way to
 * place a failed group exactly where a case is about it.
 *
 * The second wires the REAL reader over recorded GitHub responses into the REAL
 * processor with the real `inactivity` capability, and reads what arrived at
 * `decide()` off the report it produced: the issue record judged (its groups
 * were read) and the pull-request record skipped `factsUnread` (its `review`
 * group was not). That is the whole contract of this phase in one case.
 *
 * It sits at the top of `test/` rather than in `test/shell/` or `test/adapter/`
 * because it is about the seam BETWEEN them, and `.dependency-cruiser.cjs` lets
 * neither directory import the other. It reaches both through their barrels,
 * which is the same thing the composition root does.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
    parseConfigDocument,
    UNREAD,
    type EngineCapability,
    type IssueFacts,
    type ItemRef,
    type PullRequestFacts,
    type RepositoryConfig,
} from "@hiero-hackers/automation-core";
import { CAPABILITIES, inactivity } from "@hiero-hackers/automation-capabilities";
import { useTempDir } from "@hiero-hackers/automation-testkit";
import { createFactsReader } from "../src/adapter/index.js";
import {
    createProcessor,
    createSweep,
    stubbedExternals,
    SWEEP_EFFECT,
    sweepScheduleId,
    type ConfigSource,
    type FactRecordInput,
    type ShellEvent,
    type ShellRecord,
    type SweepFacts,
    type SweptItem,
    type SweptItems,
} from "../src/shell/index.js";
import { Store } from "../src/store/index.js";
import { httpHarness, installationToken, success, type ResponseStep } from "./adapter/harness.js";

const REPOSITORY = { owner: "hiero-hackers", repo: "sdk-automations" } as const;
const SCHEDULE = sweepScheduleId(REPOSITORY);
const DUE_AT = "2026-09-09T00:00:00.000Z";
const NOW = new Date("2026-09-09T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60_000;

const ISSUE: ItemRef = { kind: "issue", number: 12 };
const PULL: ItemRef = { kind: "pullRequest", number: 34 };

const CONFIG_TEXT = `schemaVersion: 1
mode: dry-run
capabilities:
  inactivity:
    enabled: true
    settings:
      remindAfterDays: 14
      reapAfterDays: 21
      issues:
        enabled: true
      pullRequests:
        enabled: true
mappings:
  commands:
    working: "/working"
`;

function configFrom(text: string, capabilities: readonly EngineCapability[]): RepositoryConfig {
    const result = parseConfigDocument(text, {
        revision: "rev-sweep-1",
        knownCapabilities: capabilities.map(({ declaration }) => declaration),
    });
    expect(result.ok, "the suite's configuration parses").toBe(true);
    if (!result.ok) throw new Error("unreachable: asserted above");
    return result.config;
}

const temp = useTempDir("runtime-sweep-");
let store: Store;
let logged: ShellEvent[];

beforeEach(() => {
    store = new Store(temp.file("store.sqlite"));
    logged = [];
});

const log = (event: ShellEvent): void => {
    logged.push(event);
};

const events = (name: ShellEvent["event"]): ShellEvent[] =>
    logged.filter((event) => event.event === name);

/** The row the processor would have declared, armed at `dueAt`. */
function armed(dueAt = DUE_AT): void {
    store.schedule(SCHEDULE, dueAt, SWEEP_EFFECT);
}

// ─── The scripted halves ─────────────────────────────────────────────

const listedItem = (item: ItemRef): SweptItem => ({
    item,
    author: "opener",
    labels: [],
    assignees: ["ada"],
    closedBy: null,
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
});

const CLOCK = [
    { login: "ada", assignedAt: new Date("2026-08-01T00:00:00.000Z"), lastWorkingAt: null },
];

const POSITION = {
    kind: "position",
    state: { meaning: null, blocked: false, closedBy: null },
    ignored: [],
} as const;

/** What a scripted reader is told to answer with; everything else is read. */
interface Script {
    readonly items?: SweptItems;
    /** The issues one pull request closes, or `"unread"` for a query that failed. */
    readonly closes?: readonly ItemRef[] | "unread";
}

interface ScriptedReader {
    readonly facts: (config: RepositoryConfig) => SweepFacts;
    /** Every `issueFacts` call's second argument, in order. */
    readonly issueLinks: (readonly ItemRef[] | "unread")[];
}

function scriptedReader(script: Script = {}): ScriptedReader {
    const issueLinks: (readonly ItemRef[] | "unread")[] = [];
    const facts = (_config: RepositoryConfig): SweepFacts => ({
        openItems: () =>
            Promise.resolve(
                script.items ?? { ok: true, items: [listedItem(ISSUE), listedItem(PULL)] },
            ),
        issueFacts: (listed, links) => {
            issueLinks.push(links);
            const record: IssueFacts = {
                kind: "issue",
                repository: REPOSITORY,
                item: listed.item,
                observedAt: NOW,
                trigger: { kind: "sweep" },
                author: listed.author,
                actor: null,
                position: POSITION,
                alerts: { carried: [], arrived: [] },
                assignees: CLOCK,
                links: links === UNREAD ? UNREAD : { openPullRequests: links },
                command: UNREAD,
            };
            return Promise.resolve(record);
        },
        pullRequestFacts: (listed) => {
            const closes = script.closes ?? [ISSUE];
            const record: PullRequestFacts = {
                kind: "pullRequest",
                repository: REPOSITORY,
                item: listed.item,
                observedAt: NOW,
                trigger: { kind: "sweep" },
                author: listed.author,
                actor: null,
                position: POSITION,
                alerts: { carried: [], arrived: [] },
                assignees: CLOCK,
                links:
                    closes === "unread"
                        ? UNREAD
                        : { issues: closes.map((item) => ({ item, assignees: CLOCK })) },
                // Never filled: the three reads it is built from are unconfirmed.
                review: UNREAD,
                readiness: { draft: false },
            };
            return Promise.resolve(record);
        },
    });
    return { facts, issueLinks };
}

interface ScriptedProcessor {
    readonly processor: {
        configuration: () => Promise<RepositoryConfig | null>;
        processFacts: (input: FactRecordInput) => Promise<ShellRecord>;
    };
    readonly decided: FactRecordInput[];
}

function scriptedProcessor(
    config: RepositoryConfig | null,
    onFacts?: () => never,
): ScriptedProcessor {
    const decided: FactRecordInput[] = [];
    return {
        decided,
        processor: {
            configuration: () => Promise.resolve(config),
            processFacts: (input) => {
                decided.push(input);
                onFacts?.();
                return Promise.resolve({
                    kind: "decision",
                    deliveryId: input.deliveryId,
                    event: "sweep",
                    receivedAt: input.receivedAt,
                    decidedAt: NOW.toISOString(),
                    configRevision: input.config.revision,
                    report: {
                        revision: input.config.revision,
                        mode: input.config.mode,
                        repository: REPOSITORY,
                        findings: [],
                    },
                    effects: [],
                });
            },
        },
    };
}

interface Driven {
    readonly reader: ScriptedReader;
    readonly decided: FactRecordInput[];
    run(): Promise<void>;
}

function driven(script: Script = {}, config = configFrom(CONFIG_TEXT, CAPABILITIES)): Driven {
    const reader = scriptedReader(script);
    const { processor, decided } = scriptedProcessor(config);
    const sweep = createSweep({
        store,
        capabilities: CAPABILITIES,
        processor,
        facts: reader.facts,
        clock: () => NOW,
        cadenceMs: DAY_MS,
        log,
    });
    return { reader, decided, run: () => sweep.runDue() };
}

// ─── The driver ──────────────────────────────────────────────────────

describe("a due sweep row", () => {
    it("builds one record per open item and hands each to the processor once", async () => {
        armed();
        const { decided, run } = driven();

        await run();

        // Pull requests first: the issues' links are their link reads reversed.
        expect(decided.map((input) => input.deliveryId)).toEqual([
            `${SCHEDULE}:pullRequest#34`,
            `${SCHEDULE}:issue#12`,
        ]);
        expect(decided.map((input) => input.facts.trigger)).toEqual([
            { kind: "sweep" },
            { kind: "sweep" },
        ]);
        expect(decided.every((input) => input.receivedAt === DUE_AT)).toBe(true);
    });

    it("gives each issue the pull requests that close it, from the sweep's own reads", async () => {
        armed();
        const { reader, run } = driven();

        await run();

        expect(reader.issueLinks).toEqual([[PULL]]);
    });

    it("gives an issue nothing closes an empty list, which is a read answer", async () => {
        armed();
        const { reader, decided, run } = driven({ closes: [] });

        await run();

        expect(reader.issueLinks).toEqual([[]]);
        expect(decided[1]?.facts.links).toEqual({ openPullRequests: [] });
    });

    it("leaves every issue's links unread when one pull request's links were not read", async () => {
        armed();
        const { reader, decided, run } = driven({ closes: "unread" });

        await run();

        expect(reader.issueLinks).toEqual(["unread"]);
        expect(decided.map((input) => input.facts.links)).toEqual([UNREAD, UNREAD]);
    });

    it("arms the next firing a cadence out, and releases the claim", async () => {
        armed();

        await driven().run();

        expect(store.claimDue(NOW.toISOString())).toEqual([]);
        const next = store.claimDue(new Date(NOW.getTime() + DAY_MS).toISOString());
        expect(next).toMatchObject([
            { scheduleId: SCHEDULE, dueAt: new Date(NOW.getTime() + DAY_MS).toISOString() },
        ]);
        expect(events("sweepFinished")).toMatchObject([
            { scheduleId: SCHEDULE, items: 2, decided: 2, unread: 0 },
        ]);
    });

    it("claims nothing before it is due", async () => {
        armed("2026-09-10T00:00:00.000Z");
        const { decided, run } = driven();

        await run();

        expect(decided).toEqual([]);
        expect(logged).toEqual([]);
    });
});

describe("a firing that reads nothing", () => {
    it("says the list was unreadable, and still arms the next one", async () => {
        armed();
        const { decided, run } = driven({
            items: { ok: false, detail: "GitHub refused the read" },
        });

        await run();

        expect(decided).toEqual([]);
        expect(events("sweepUnreadable")).toMatchObject([
            { scheduleId: SCHEDULE, detail: "GitHub refused the read" },
        ]);
        expect(events("sweepFinished")).toMatchObject([{ items: 0, decided: 0 }]);
    });

    it("reads no item when the configuration could not be read", async () => {
        armed();
        const reader = scriptedReader();
        const { processor, decided } = scriptedProcessor(null);
        const sweep = createSweep({
            store,
            capabilities: CAPABILITIES,
            processor,
            facts: reader.facts,
            clock: () => NOW,
            cadenceMs: DAY_MS,
            log,
        });

        await sweep.runDue();

        expect(decided).toEqual([]);
        expect(events("sweepFinished")).toHaveLength(1);
    });

    it("reads no item when the repository enables no clock-driven capability", async () => {
        armed();
        const { decided, run } = driven(
            {},
            configFrom("schemaVersion: 1\nmode: dry-run\n", CAPABILITIES),
        );

        await run();

        expect(decided).toEqual([]);
        expect(events("sweepFinished")).toMatchObject([{ items: 0 }]);
    });

    it("contains a decision that threw, and arms the next firing anyway", async () => {
        armed();
        const reader = scriptedReader();
        const { processor } = scriptedProcessor(configFrom(CONFIG_TEXT, CAPABILITIES), () => {
            throw new Error("the store is closed");
        });
        const sweep = createSweep({
            store,
            capabilities: CAPABILITIES,
            processor,
            facts: reader.facts,
            clock: () => NOW,
            cadenceMs: DAY_MS,
            log,
        });

        await sweep.runDue();

        expect(events("sweepFailed")).toMatchObject([
            { detail: expect.stringContaining("closed") },
        ]);
        expect(store.claimDue(new Date(NOW.getTime() + DAY_MS).toISOString())).toHaveLength(1);
    });
});

describe("the claim", () => {
    it("says so when a redrive took the row over mid-firing", async () => {
        armed();
        const reader = scriptedReader();
        const { processor } = scriptedProcessor(configFrom(CONFIG_TEXT, CAPABILITIES));
        const sweep = createSweep({
            store,
            capabilities: CAPABILITIES,
            processor,
            // The redrive happens while the list is being read, which is the
            // only window a takeover can open in.
            facts: (config) => {
                store.requeueStuck(NOW.toISOString());
                return reader.facts(config);
            },
            clock: () => NOW,
            cadenceMs: DAY_MS,
            log,
        });

        await sweep.runDue();

        expect(events("sweepFailed")).toMatchObject([
            { detail: `the claim on "${SCHEDULE}" was lost` },
        ]);
        expect(events("sweepFinished")).toEqual([]);
    });

    it("says so when the store itself could not be asked", async () => {
        armed();
        const { run } = driven();
        store.close();

        await run();

        expect(events("sweepFailed")).toMatchObject([
            { detail: expect.stringContaining("database is not open") },
        ]);
        expect(events("sweepClaimed")).toEqual([]);
    });

    it("hands back a due row carrying an effect this shell cannot fire", async () => {
        store.schedule("retention:nightly", DUE_AT, "prune");
        const { decided, run } = driven();

        await run();

        expect(decided).toEqual([]);
        expect(events("sweepFailed")).toMatchObject([
            { detail: expect.stringContaining('unknown effect "prune"') },
        ]);
        expect(store.claimDue(new Date(NOW.getTime() + DAY_MS).toISOString())).toMatchObject([
            { scheduleId: "retention:nightly" },
        ]);
    });

    it("shares one pass between overlapping ticks, and a shutdown joins it", async () => {
        armed();
        const sweep = createSweep({
            store,
            capabilities: CAPABILITIES,
            processor: scriptedProcessor(configFrom(CONFIG_TEXT, CAPABILITIES)).processor,
            facts: scriptedReader().facts,
            clock: () => NOW,
            cadenceMs: DAY_MS,
            log,
        });

        const first = sweep.runDue();
        const second = sweep.runDue();
        expect(second).toBe(first);
        await sweep.settled();

        await first;
        expect(sweep.settled()).resolves.toBeUndefined();
        expect(events("sweepClaimed")).toHaveLength(1);
    });
});

// ─── The whole seam ──────────────────────────────────────────────────

/** Recorded GitHub, routed by path; anything unrouted is a failing 404. */
function routed(routes: Readonly<Record<string, unknown>>): ResponseStep {
    return (url) => {
        for (const [fragment, body] of Object.entries(routes)) {
            if (url.includes(fragment)) return success(JSON.stringify(body));
        }
        return new Response('{"message":"no route"}', { status: 404 });
    };
}

describe("the reader and the driver together", () => {
    /**
     * One stale issue with one assignee, and one pull request that closes it —
     * the smallest repository that exercises every group the sweep can fill.
     */
    const RECORDED = {
        "/issues?": [
            {
                number: 12,
                state: "open",
                updated_at: "2026-08-01T00:00:00Z",
                labels: [],
                user: { login: "ada" },
                assignees: [{ login: "ada" }],
            },
            {
                number: 34,
                state: "open",
                updated_at: "2026-08-02T00:00:00Z",
                labels: [],
                user: { login: "ada" },
                assignees: [{ login: "ada" }],
                pull_request: { url: "https://api.github.com/pulls/34" },
            },
        ],
        "/issues/12/timeline": [
            { event: "assigned", assignee: { login: "ada" }, created_at: "2026-07-01T00:00:00Z" },
        ],
        "/issues/12/comments": [
            { user: { login: "ada" }, created_at: "2026-07-02T00:00:00Z", body: "/working" },
        ],
        "/issues/34/timeline": [
            { event: "assigned", assignee: { login: "ada" }, created_at: "2026-07-01T00:00:00Z" },
        ],
        "/issues/34/comments": [],
        "/graphql": {
            data: {
                repository: {
                    nameWithOwner: `${REPOSITORY.owner}/${REPOSITORY.repo}`,
                    pullRequest: {
                        number: 34,
                        closingIssuesReferences: {
                            nodes: [
                                {
                                    number: 12,
                                    repository: {
                                        nameWithOwner: `${REPOSITORY.owner}/${REPOSITORY.repo}`,
                                    },
                                },
                            ],
                            pageInfo: { hasNextPage: false, endCursor: null },
                        },
                    },
                },
            },
        },
    };

    it("carries a recorded repository into decide(), groups read and unread as they are", async () => {
        armed();
        const capabilities: readonly EngineCapability[] = [inactivity];
        const configSource: ConfigSource = {
            load: () =>
                Promise.resolve({
                    ok: true,
                    document: { revision: "rev-sweep-1", text: CONFIG_TEXT },
                }),
        };
        const http = httpHarness([routed(RECORDED)], {
            outcomes: [
                {
                    ok: true,
                    token: {
                        ...installationToken("sweep-token"),
                        grants: ["issues:write", "pull_requests:read"],
                    },
                },
            ],
        });
        const processor = createProcessor({
            store,
            capabilities,
            configSource,
            externals: () => stubbedExternals(),
            repository: REPOSITORY,
            worker: "sweep-1",
            clock: () => NOW,
            log,
        });
        const records: ShellRecord[] = [];
        const handed: FactRecordInput[] = [];
        const sweep = createSweep({
            store,
            capabilities,
            processor: {
                configuration: () => processor.configuration(),
                processFacts: async (input) => {
                    handed.push(input);
                    const record = await processor.processFacts(input);
                    records.push(record);
                    return record;
                },
            },
            facts: (config) =>
                createFactsReader({
                    http: http.client,
                    repository: REPOSITORY,
                    config,
                    clock: () => NOW,
                }),
            clock: () => NOW,
            cadenceMs: DAY_MS,
            log,
        });

        await sweep.runDue();

        const codesOf = (record: ShellRecord): string[] =>
            record.kind === "decision" ? record.report.findings.map((finding) => finding.code) : [];
        const [pull, issue] = records;

        // The pull request's `review` group is built from three reads no
        // protocol has confirmed, so the ladder is skipped rather than guessing.
        expect(pull?.deliveryId).toBe(`${SCHEDULE}:pullRequest#34`);
        expect(codesOf(pull!)).toEqual(["factsUnread"]);

        // The issue's are both read, so it is judged — and nothing it needs is
        // reported unread. The record it was judged from carries the clocks the
        // timeline and comments dated, and the pull request that closes it.
        expect(issue?.deliveryId).toBe(`${SCHEDULE}:issue#12`);
        expect(codesOf(issue!)).not.toContain("factsUnread");
        const judged = handed[1]?.facts;
        expect(judged).toMatchObject({
            kind: "issue",
            item: ISSUE,
            trigger: { kind: "sweep" },
            observedAt: NOW,
            assignees: [
                {
                    login: "ada",
                    assignedAt: new Date("2026-07-01T00:00:00Z"),
                    lastWorkingAt: new Date("2026-07-02T00:00:00Z"),
                },
            ],
            links: { openPullRequests: [PULL] },
        });
        // And the pull request's own record says `review` is the group nobody
        // read — the three reads it is built from have no citation yet.
        expect(handed[0]?.facts).toMatchObject({
            kind: "pullRequest",
            assignees: [{ login: "ada" }],
            links: { issues: [{ item: ISSUE }] },
            review: UNREAD,
        });
        expect(events("sweepFinished")).toMatchObject([{ items: 2, decided: 2 }]);
    });
});
