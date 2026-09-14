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
 * box with the real `inactivity` capability, and reads what arrived at
 * `decide()` off the report it produced: the issue record judged (its groups
 * were read) and the pull-request record skipped `factsUnread` (its `review`
 * group was not). That is the whole contract of this phase in one case.
 *
 * It sits beside the driver it covers, and reaches the adapter's real reader
 * and its fake under the one allowance `adapter-imported-at-shell-main-only`
 * carries for this directory: the sweep is the seam between the two, and the
 * barrel is how it crosses, the way the composition root does.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
    asDeliveryGuid,
    parseConfigDocument,
    UNREAD,
    type DeliveryGuid,
    type EngineCapability,
    type IssueFacts,
    type ItemRef,
    type PullRequestFacts,
    type RepositoryConfig,
} from "@hiero-hackers/automation-core";
import { CAPABILITIES, inactivity } from "@hiero-hackers/automation-capabilities";
import { useTempDir } from "@hiero-hackers/automation-testkit";
import { createFactsReader, orderingEvidenceSource } from "../../../src/adapter/index.js";
import {
    createDeliveries,
    createItemDecider,
    createSweep,
    serializeCall,
    stubbedExternals,
    SWEEP_EFFECT,
    repositoryOfScheduleId,
    SWEEP_READ_REQUESTS,
    SWEEP_WRITE_CALLS,
    sweepScheduleId,
    type ConfigSource,
    type Decided,
    type EffectOutcome,
    type ItemInput,
    type RequestBudget,
    type ShellEvent,
    type SweepFacts,
    type SweepFactsSource,
    type SweepOptions,
    type SweepProcessor,
    type SweptItem,
    type SweptItems,
    type WriteBudget,
} from "../../../src/shell/index.js";
import { Store, type Fact } from "../../../src/store/index.js";
import {
    httpHarness,
    installationToken,
    success,
    type ResponseStep,
} from "../../adapter/harness.js";

const REPOSITORY = { owner: "hiero-hackers", repo: "sdk-automations" } as const;
const SCHEDULE = sweepScheduleId(REPOSITORY);
const DUE_AT = "2026-09-09T00:00:00.000Z";
const NOW = new Date("2026-09-09T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60_000;

const ISSUE: ItemRef = { kind: "issue", number: 12 };
const PULL: ItemRef = { kind: "pullRequest", number: 34 };

const CONFIG_TEXT = `schemaVersion: 2
mode: dry-run
capabilities:
  inactivity:
    enabled: true
    remindAfter: 14d
    reap:
      after: 21d
    issues:
      enabled: true
      reap:
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

/** The row the delivery lane would have declared, armed at `dueAt`. */
function armed(dueAt = DUE_AT): void {
    store.ledger.schedule(SCHEDULE, dueAt, SWEEP_EFFECT);
}

/** The half of a processor a case scripts; its reader is supplied beside it. */
type Deciding = Omit<SweepProcessor, "facts">;

/** Every schedule row in this file is one repository's, so one processor answers for all. */
const sweeping =
    (processor: Deciding, facts: SweepFactsSource): SweepOptions["processorFor"] =>
    () => ({ ...processor, facts });

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
}

function scriptedReader(script: Script = {}): ScriptedReader {
    const facts = (_config: RepositoryConfig): SweepFacts => ({
        openItems: () =>
            Promise.resolve(
                script.items ?? { ok: true, items: [listedItem(ISSUE), listedItem(PULL)] },
            ),
        issueFacts: (listed, links) => {
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
    return { facts };
}

/** One call the driver made on the shared box, as the box's own signature takes it. */
interface Handed {
    readonly input: Extract<ItemInput, { kind: "facts" }>;
    readonly config: RepositoryConfig;
    readonly at: string;
    readonly budget: WriteBudget | undefined;
}

interface ScriptedProcessor {
    readonly processor: Deciding;
    readonly decided: Handed[];
}

/** What one decided swept item comes back as, carrying what became of its effects. */
const decidedAs = (config: RepositoryConfig, outcomes: readonly EffectOutcome[]): Decided => ({
    kind: "decided",
    report: {
        revision: config.revision,
        mode: config.mode,
        repository: REPOSITORY,
        findings: [],
    },
    outcomes,
});

/** Every call recorded, with the facts arm narrowed: the sweep sends no deliveries. */
function handedIn(
    decided: Handed[],
): (...args: Parameters<SweepProcessor["decideItem"]>) => Handed {
    return (input, config, at, budget) => {
        expect(input.kind, "the sweep decides fact records").toBe("facts");
        const handed = {
            input: input as Extract<ItemInput, { kind: "facts" }>,
            config,
            at,
            budget,
        };
        decided.push(handed);
        return handed;
    };
}

function scriptedProcessor(
    config: RepositoryConfig | null,
    onFacts?: () => never,
): ScriptedProcessor {
    const decided: Handed[] = [];
    const record = handedIn(decided);
    return {
        decided,
        processor: {
            configuration: () => Promise.resolve(config),
            decideItem: (...args) => {
                record(...args);
                onFacts?.();
                return Promise.resolve(decidedAs(args[1], []));
            },
        },
    };
}

interface Driven {
    readonly reader: ScriptedReader;
    readonly decided: Handed[];
    run(): Promise<void>;
}

function driven(script: Script = {}, config = configFrom(CONFIG_TEXT, CAPABILITIES)): Driven {
    const reader = scriptedReader(script);
    const { processor, decided } = scriptedProcessor(config);
    const sweep = createSweep({
        store,
        capabilities: CAPABILITIES,
        processorFor: sweeping(processor, reader.facts),
        clock: () => NOW,
        cadenceMs: DAY_MS,
        writeCap: SWEEP_WRITE_CALLS,
        readBudget: SWEEP_READ_REQUESTS,
        requestsMade: () => 0,
        log,
    });
    return { reader, decided, run: () => sweep.runDue() };
}

// ─── The driver ──────────────────────────────────────────────────────

/** A row's id is the only place its repository is written down, so it must read back. */
describe("the repository a sweep row names", () => {
    it.each([
        { owner: "hiero-hackers", repo: "sdk-automations" },
        { owner: "o", repo: "r" },
        { owner: "Mixed-Case", repo: "dots.and-dashes" },
    ])("survives the round trip for $owner/$repo", (repository) => {
        expect(repositoryOfScheduleId(sweepScheduleId(repository))).toEqual(repository);
    });

    it.each([
        ["another effect's row", "retention:nightly"],
        ["no prefix", "hiero-hackers/sdk-automations"],
        ["no repository", "sweep:"],
        ["no name", "sweep:hiero-hackers"],
        ["an empty name", "sweep:hiero-hackers/"],
        ["an empty owner", "sweep:/sdk-automations"],
        ["a third segment", "sweep:hiero-hackers/sdk-automations/main"],
    ])("reads %s as no repository at all", (_shape, scheduleId) => {
        expect(repositoryOfScheduleId(scheduleId)).toBeNull();
    });
});

describe("a due sweep row", () => {
    it("builds one record per open item and hands each to the box once", async () => {
        armed();
        const { decided, run } = driven();

        await run();

        // Number order, whatever the kind: what a firing read is a prefix of the list.
        expect(decided.map(({ input }) => input.facts.item)).toEqual([ISSUE, PULL]);
        expect(decided.every(({ input }) => input.scheduleId === SCHEDULE)).toBe(true);
        expect(decided.map(({ input }) => input.facts.trigger)).toEqual([
            { kind: "sweep" },
            { kind: "sweep" },
        ]);
        expect(decided.every(({ at }) => at === DUE_AT)).toBe(true);
    });

    it("gives each issue the pull requests that close it, from the sweep's own reads", async () => {
        armed();
        const { decided, run } = driven();

        // The pull request is read after the issue, so the links are completed once
        // every pull request this firing read is in.
        await run();

        expect(decided[0]?.input.facts.links).toEqual({ openPullRequests: [PULL] });
    });

    it("gives an issue nothing closes an empty list, which is a read answer", async () => {
        armed();
        const { decided, run } = driven({ closes: [] });

        await run();

        expect(decided[0]?.input.facts.links).toEqual({ openPullRequests: [] });
    });

    it("leaves every issue's links unread when one pull request's links were not read", async () => {
        armed();
        const { decided, run } = driven({ closes: "unread" });

        await run();

        expect(decided.map(({ input }) => input.facts.links)).toEqual([UNREAD, UNREAD]);
    });

    it("arms the next firing a cadence out, and releases the claim", async () => {
        armed();

        await driven().run();

        expect(store.ledger.claimDue(NOW.toISOString())).toEqual([]);
        const next = store.ledger.claimDue(new Date(NOW.getTime() + DAY_MS).toISOString());
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
            processorFor: sweeping(processor, reader.facts),
            clock: () => NOW,
            cadenceMs: DAY_MS,
            writeCap: SWEEP_WRITE_CALLS,
            readBudget: SWEEP_READ_REQUESTS,
            requestsMade: () => 0,
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
            processorFor: sweeping(processor, reader.facts),
            clock: () => NOW,
            cadenceMs: DAY_MS,
            writeCap: SWEEP_WRITE_CALLS,
            readBudget: SWEEP_READ_REQUESTS,
            requestsMade: () => 0,
            log,
        });

        await sweep.runDue();

        expect(events("sweepFailed")).toMatchObject([
            { detail: expect.stringContaining("closed") },
        ]);
        expect(store.ledger.claimDue(new Date(NOW.getTime() + DAY_MS).toISOString())).toHaveLength(
            1,
        );
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
            // The redrive happens while the list is being read, which is the
            // only window a takeover can open in.
            processorFor: sweeping(processor, (config) => {
                store.ledger.requeueStuck(NOW.toISOString());
                return reader.facts(config);
            }),
            clock: () => NOW,
            cadenceMs: DAY_MS,
            writeCap: SWEEP_WRITE_CALLS,
            readBudget: SWEEP_READ_REQUESTS,
            requestsMade: () => 0,
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
        store.ledger.schedule("retention:nightly", DUE_AT, "prune");
        const { decided, run } = driven();

        await run();

        expect(decided).toEqual([]);
        expect(events("sweepFailed")).toMatchObject([
            { detail: expect.stringContaining('unknown effect "prune"') },
        ]);
        expect(store.ledger.claimDue(new Date(NOW.getTime() + DAY_MS).toISOString())).toMatchObject(
            [{ scheduleId: "retention:nightly" }],
        );
    });

    /**
     * One process serves the installation (D169), so a tick may find a due row
     * for each repository in it. Each is read through its OWN facts source and
     * decided by its own box: the id is where the repository comes from.
     */
    it("fires every due row through its own repository's reader and box", async () => {
        const OTHER = { owner: "hiero-hackers", repo: "other-sdk" } as const;
        armed();
        store.ledger.schedule(sweepScheduleId(OTHER), DUE_AT, SWEEP_EFFECT);
        const config = configFrom(CONFIG_TEXT, CAPABILITIES);
        const decided: Handed[] = [];
        const record = handedIn(decided);
        const read: string[] = [];
        const sweep = createSweep({
            store,
            capabilities: CAPABILITIES,
            processorFor: (repository) => ({
                configuration: () => Promise.resolve(config),
                decideItem: (input, under, at, budget) => {
                    record(input, under, at, budget);
                    return Promise.resolve(decidedAs(under, []));
                },
                facts: () => ({
                    openItems: () => {
                        read.push(`${repository.owner}/${repository.repo}`);
                        return Promise.resolve({ ok: true, items: [listedItem(ISSUE)] });
                    },
                    issueFacts: (listed, links) =>
                        Promise.resolve({
                            kind: "issue",
                            repository,
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
                        }),
                    pullRequestFacts: () => Promise.reject(new Error("none is listed")),
                }),
            }),
            clock: () => NOW,
            cadenceMs: DAY_MS,
            writeCap: SWEEP_WRITE_CALLS,
            readBudget: SWEEP_READ_REQUESTS,
            requestsMade: () => 0,
            log,
        });

        await sweep.runDue();

        // One reader each, and the record each decided names its own repository.
        expect(new Set(read)).toEqual(
            new Set([`${REPOSITORY.owner}/${REPOSITORY.repo}`, `${OTHER.owner}/${OTHER.repo}`]),
        );
        expect(new Set(decided.map(({ input }) => input.scheduleId))).toEqual(
            new Set([SCHEDULE, sweepScheduleId(OTHER)]),
        );
        expect(decided.map(({ input }) => input.facts.repository)).toEqual(
            decided.map(({ input }) => repositoryOfScheduleId(input.scheduleId)),
        );
    });

    it("hands back a sweep row whose id names no repository", async () => {
        store.ledger.schedule("sweep:nonsense", DUE_AT, SWEEP_EFFECT);
        const { decided, run } = driven();

        await run();

        expect(decided).toEqual([]);
        expect(events("sweepFailed")).toMatchObject([
            { detail: 'schedule "sweep:nonsense" names no repository' },
        ]);
        expect(store.ledger.claimDue(new Date(NOW.getTime() + DAY_MS).toISOString())).toMatchObject(
            [{ scheduleId: "sweep:nonsense" }],
        );
    });

    it("shares one pass between overlapping ticks, and a shutdown joins it", async () => {
        armed();
        const sweep = createSweep({
            store,
            capabilities: CAPABILITIES,
            processorFor: sweeping(
                scriptedProcessor(configFrom(CONFIG_TEXT, CAPABILITIES)).processor,
                scriptedReader().facts,
            ),
            clock: () => NOW,
            cadenceMs: DAY_MS,
            writeCap: SWEEP_WRITE_CALLS,
            readBudget: SWEEP_READ_REQUESTS,
            requestsMade: () => 0,
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

// ─── The write cap ───────────────────────────────────────────────────

/** One approved effect's outcome, as the applier reports it for a swept item. */
const effectOn = (
    item: ItemRef,
    outcome: EffectOutcome["outcome"],
    code: EffectOutcome["code"] = null,
): EffectOutcome => ({
    effectId: `effect:${item.kind}#${String(item.number)}`,
    capability: "inactivity",
    operation: "postManagedComment",
    item,
    outcome,
    code,
    detail: null,
});

interface Spending {
    readonly processor: Deciding;
    /** Every call the firing handed down, to see whether they shared one budget. */
    readonly handed: Handed[];
    /** The item numbers a write landed on, in order. */
    readonly written: number[];
}

/**
 * A box that spends the firing's budget the way the applier does: one write per
 * item nothing has written to, nothing for one already written, and a
 * `sweepWriteCap` refusal once the firing's writes are spent.
 */
function spending(config: RepositoryConfig): Spending {
    const handed: Handed[] = [];
    const record = handedIn(handed);
    const written: number[] = [];
    return {
        handed,
        written,
        processor: {
            configuration: () => Promise.resolve(config),
            decideItem: (...args) => {
                const { input, config: under, budget } = record(...args);
                const { item } = input.facts;
                const left = budget ?? { remaining: 0 };
                if (written.includes(item.number)) {
                    return Promise.resolve(decidedAs(under, [effectOn(item, "already")]));
                }
                if (left.remaining === 0) {
                    return Promise.resolve(
                        decidedAs(under, [effectOn(item, "refused", "sweepWriteCap")]),
                    );
                }
                left.remaining -= 1;
                written.push(item.number);
                return Promise.resolve(decidedAs(under, [effectOn(item, "applied")]));
            },
        },
    };
}

describe("the writes one firing may send", () => {
    it("sends up to the cap, carries the rest, and decides them again next firing", async () => {
        armed();
        const items = [12, 13, 14].map((number) => listedItem({ kind: "issue", number }));
        const reader = scriptedReader({ items: { ok: true, items } });
        const { processor, handed, written } = spending(configFrom(CONFIG_TEXT, CAPABILITIES));
        let now = NOW;
        const sweep = createSweep({
            store,
            capabilities: CAPABILITIES,
            processorFor: sweeping(processor, reader.facts),
            clock: () => now,
            cadenceMs: DAY_MS,
            writeCap: 2,
            readBudget: SWEEP_READ_REQUESTS,
            requestsMade: () => 0,
            log,
        });

        await sweep.runDue();

        expect(written).toEqual([12, 13]);
        expect(events("sweepFinished")).toMatchObject([
            { items: 3, decided: 3, writes: 2, heldBack: 1 },
        ]);
        // One budget for the firing, not one per record.
        expect(new Set(handed.map(({ budget }) => budget)).size).toBe(1);

        now = new Date(NOW.getTime() + DAY_MS);
        await sweep.runDue();

        // Nothing was journalled for the item held back, so its act stands.
        expect(written).toEqual([12, 13, 14]);
        expect(events("sweepFinished")[1]).toMatchObject({ writes: 1, heldBack: 0 });
    });

    it("counts no write for a record that never reached a write path", async () => {
        armed();
        const reader = scriptedReader();
        const sweep = createSweep({
            store,
            capabilities: CAPABILITIES,
            processorFor: sweeping(
                {
                    configuration: () => Promise.resolve(configFrom(CONFIG_TEXT, CAPABILITIES)),
                    // The shipped composition wires no applier, so active mode ends here.
                    decideItem: () =>
                        Promise.resolve({
                            kind: "modeUnsupported",
                            reason: "active mode is unsupported by the runnable shell",
                        }),
                },
                reader.facts,
            ),
            clock: () => NOW,
            cadenceMs: DAY_MS,
            writeCap: 2,
            readBudget: SWEEP_READ_REQUESTS,
            requestsMade: () => 0,
            log,
        });

        await sweep.runDue();

        expect(events("sweepFinished")).toMatchObject([{ decided: 2, writes: 0, heldBack: 0 }]);
    });
});

// ─── The read budget ─────────────────────────────────────────────────

/** Five open issues, listed out of order: the numbers a cursor walks through (D170). */
const FIVE: readonly SweptItem[] = [13, 11, 15, 12, 14].map((number) =>
    listedItem({ kind: "issue", number }),
);

/** What the counted reader below charges: one request for the list, two for an item. */
const LIST_COST = 1;
const ITEM_COST = 2;

interface Budgeted {
    /** The item numbers handed to the box, across every firing, in order. */
    read(): number[];
    facts(): Array<IssueFacts | PullRequestFacts>;
    readonly cost: { item: number };
    /** What the next firing's list answers; a case may make it unreadable. */
    readonly listing: { items: SweptItems };
    /** Fire once, `days` cadences after the row was armed. */
    fire(days: number): Promise<void>;
}

/** One sweep under a read budget it spends in requests, fired as often as a case likes. */
function budgeted(readBudget: number, items: readonly SweptItem[] = FIVE): Budgeted {
    const listing: { items: SweptItems } = { items: { ok: true, items } };
    const { processor, decided } = scriptedProcessor(configFrom(CONFIG_TEXT, CAPABILITIES));
    let requests = 0;
    const cost = { item: ITEM_COST };
    /** The scripted reader, charging what the live one's reads would cost. */
    const counted = (config: RepositoryConfig, budget: RequestBudget): SweepFacts => {
        const reader = scriptedReader(listing).facts(config);
        const spend = (cost: number): void => {
            const sent = Math.min(cost, budget.remaining);
            requests += sent;
            budget.remaining -= sent;
            if (sent < cost) budget.exhausted = true;
        };
        return {
            openItems: () => {
                spend(LIST_COST);
                return reader.openItems();
            },
            issueFacts: (listed, links) => {
                spend(cost.item);
                return reader.issueFacts(listed, links);
            },
            pullRequestFacts: (listed, openIssues) => {
                spend(cost.item);
                return reader.pullRequestFacts(listed, openIssues);
            },
        };
    };
    let now = NOW;
    const sweep = createSweep({
        store,
        capabilities: CAPABILITIES,
        processorFor: sweeping(processor, counted),
        clock: () => now,
        cadenceMs: DAY_MS,
        writeCap: SWEEP_WRITE_CALLS,
        readBudget,
        requestsMade: () => requests,
        log,
    });
    return {
        read: () => decided.map(({ input }) => input.facts.item.number),
        facts: () => decided.map(({ input }) => input.facts),
        cost,
        listing,
        fire: (days) => {
            now = new Date(NOW.getTime() + days * DAY_MS);
            return sweep.runDue();
        },
    };
}

/** The cursor the row carries, read the way a firing reads it: by claiming it. */
const cursorAfter = (days: number): number | null | undefined =>
    store.ledger.claimDue(new Date(NOW.getTime() + days * DAY_MS).toISOString())[0]?.resumeAfter;

describe("the requests one firing may spend", () => {
    it("does not claim an issue has no linked pull request after a partial scan", async () => {
        armed();
        const firing = budgeted(LIST_COST + ITEM_COST, [listedItem(ISSUE), listedItem(PULL)]);

        await firing.fire(0);

        expect(firing.read()).toEqual([ISSUE.number]);
        expect(firing.facts()[0]?.links).toBe(UNREAD);
    });

    it("stops at the budget in number order, says what remains, and keeps the cursor", async () => {
        armed();
        // The list and two items: the third would be read past the budget.
        const firing = budgeted(LIST_COST + 2 * ITEM_COST);

        await firing.fire(0);

        // The two LOWEST numbers, though the list arrived in neither order.
        expect(firing.read()).toEqual([11, 12]);
        expect(events("sweepPartial")).toEqual([
            {
                event: "sweepPartial",
                scheduleId: SCHEDULE,
                read: 2,
                remaining: 3,
                resumeAfter: 12,
                requests: 5,
            },
        ]);
        expect(events("sweepFinished")).toMatchObject([
            { items: 5, decided: 2, remaining: 3, resumeAfter: 12, requests: 5 },
        ]);
        expect(cursorAfter(1)).toBe(12);
    });

    it("does not keep or skip an item whose reads crossed the cap", async () => {
        armed();
        const firing = budgeted(LIST_COST + ITEM_COST + 1);

        await firing.fire(0);

        expect(firing.read()).toEqual([11]);
        expect(events("sweepFinished")).toMatchObject([
            { decided: 1, remaining: 4, resumeAfter: 11, requests: 4 },
        ]);

        await firing.fire(1);

        expect(firing.read()).toEqual([11, 12]);
    });

    it("keeps an existing cursor when the first resumed item crosses the cap", async () => {
        armed();
        const firing = budgeted(LIST_COST + ITEM_COST);

        await firing.fire(0);
        firing.cost.item = ITEM_COST + 1;
        await firing.fire(1);

        expect(firing.read()).toEqual([11]);
        expect(events("sweepFinished")[1]).toMatchObject({
            decided: 0,
            remaining: 4,
            resumeAfter: 11,
            requests: 3,
        });

        firing.cost.item = ITEM_COST;
        await firing.fire(2);

        expect(firing.read()).toEqual([11, 12]);
    });

    it("reads the next two from the cursor on the next firing", async () => {
        armed();
        const firing = budgeted(5);

        await firing.fire(0);
        await firing.fire(1);

        expect(firing.read()).toEqual([11, 12, 13, 14]);
        expect(events("sweepPartial")[1]).toMatchObject({
            read: 2,
            remaining: 1,
            resumeAfter: 14,
            requests: 5,
        });
        expect(cursorAfter(2)).toBe(14);
    });

    it("clears the cursor on the firing that finishes the list, and starts over", async () => {
        armed();
        const firing = budgeted(5);

        await firing.fire(0);
        await firing.fire(1);
        await firing.fire(2);

        expect(firing.read()).toEqual([11, 12, 13, 14, 15]);
        // Nothing remained, so the third firing says nothing about a cursor.
        expect(events("sweepPartial")).toHaveLength(2);
        expect(events("sweepFinished")[2]).toMatchObject({
            items: 5,
            decided: 1,
            remaining: 0,
            resumeAfter: null,
            requests: LIST_COST + ITEM_COST,
        });
        expect(cursorAfter(3)).toBeNull();
    });

    it("reads the whole list in one firing when the budget reaches it", async () => {
        armed();
        const firing = budgeted(LIST_COST + 5 * ITEM_COST);

        await firing.fire(0);

        expect(firing.read()).toEqual([11, 12, 13, 14, 15]);
        expect(events("sweepPartial")).toEqual([]);
        expect(events("sweepFinished")).toMatchObject([
            { decided: 5, remaining: 0, resumeAfter: null, requests: 11 },
        ]);
        expect(cursorAfter(1)).toBeNull();
    });

    it("reads no item when the list alone spends the budget", async () => {
        armed();
        const firing = budgeted(LIST_COST);

        await firing.fire(0);

        // Nothing was read, so there is no cursor: the next firing starts the list again.
        expect(firing.read()).toEqual([]);
        expect(events("sweepPartial")).toEqual([]);
        expect(events("sweepFinished")).toMatchObject([
            { items: 5, decided: 0, remaining: 5, resumeAfter: null, requests: LIST_COST },
        ]);
        expect(cursorAfter(1)).toBeNull();
    });

    it("leaves the cursor where it stood when the list could not be read", async () => {
        armed();
        const firing = budgeted(5);

        await firing.fire(0);
        firing.listing.items = { ok: false, detail: "GitHub refused the read" };
        await firing.fire(1);

        expect(firing.read()).toEqual([11, 12]);
        expect(events("sweepUnreadable")).toHaveLength(1);
        // The list read is spent whether or not it answered.
        expect(events("sweepFinished")[1]).toMatchObject({
            items: 0,
            resumeAfter: 12,
            requests: LIST_COST,
        });
        expect(cursorAfter(2)).toBe(12);
    });
});

// ─── Retention ───────────────────────────────────────────────────────

const OLD_DELIVERY = asDeliveryGuid("00000000-0000-0000-0000-0000000000d1")!;
const NEW_DELIVERY = asDeliveryGuid("00000000-0000-0000-0000-0000000000d2")!;

/** One delivery carried to `done` at `completedAt`, which is the only state retention reaches. */
function completed(deliveryId: DeliveryGuid, completedAt: string): void {
    store.inbox.acceptDelivery({
        deliveryId,
        eventName: "issues",
        payload: Buffer.from(deliveryId),
        receivedAt: completedAt,
    });
    const claim = store.inbox.claimNextDelivery(
        "worker-a",
        completedAt,
        "2026-01-01T00:00:00.000Z",
    );
    expect(claim, "the delivery to complete was claimed").not.toBeUndefined();
    expect(
        store.inbox.completeDelivery({
            deliveryId: claim!.deliveryId,
            eventName: claim!.eventName,
            payloadDigest: claim!.payloadDigest,
            claimToken: claim!.claimToken,
            completedAt,
        }),
    ).toEqual({ outcome: "completed" });
}

/** The columns a fact needs that no retention case is about. */
const FACT = {
    seq: 1,
    revision: "rev-sweep-1",
    capability: "inactivity",
    repository: REPOSITORY,
    item: ISSUE,
    verb: "postComment",
    login: null,
    code: null,
    detail: null,
} as const;

/** The columns a decision needs that no retention case is about. */
const DECISION = {
    source: "sweep",
    sourceId: SCHEDULE,
    repository: REPOSITORY,
    item: ISSUE,
    capability: "inactivity",
    verdict: "apply",
    code: null,
    detail: null,
    effectId: null,
} as const;

describe("what one firing prunes", () => {
    /** Either side of the thirty-day windows, and well past the ninety-day one (D166). */
    const PAST_30 = "2026-07-01T00:00:00.000Z";
    const WITHIN_30 = "2026-09-01T00:00:00.000Z";
    const PAST_90 = "2026-05-01T00:00:00.000Z";

    it("takes a done delivery past the window, and keeps one inside it", async () => {
        armed();
        completed(OLD_DELIVERY, PAST_30);
        completed(NEW_DELIVERY, WITHIN_30);

        await driven().run();

        // One left, and its completion instant says which: the newer one.
        expect(store.inbox.counts()).toMatchObject({ done: 1, oldestDone: WITHIN_30 });
        expect(events("sweepPruned")).toMatchObject([{ deliveries: 1, effects: 0, decisions: 0 }]);
    });

    it("takes a settled effect past the window, and keeps an open send however old", async () => {
        armed();
        const facts: Fact[] = [
            { ...FACT, effectId: "settled", kind: "sent", at: PAST_90, payload: "{}" },
            { ...FACT, effectId: "settled", kind: "landed", at: PAST_90, payload: null },
            { ...FACT, effectId: "open", kind: "sent", at: PAST_90, payload: "{}" },
        ];
        for (const fact of facts) store.ledger.record(fact);

        await driven().run();

        expect(store.ledger.factsOf("settled")).toEqual([]);
        expect(store.ledger.factsOf("open")).toHaveLength(1);
        expect(events("sweepPruned")).toMatchObject([{ deliveries: 0, effects: 2, decisions: 0 }]);
    });

    it("keeps a warned effect whose earliest action is still ahead", async () => {
        armed();
        store.ledger.record({
            ...FACT,
            effectId: "promised",
            seq: 0,
            verb: null,
            kind: "warned",
            at: PAST_90,
            payload: JSON.stringify({ earliestActionAt: "2026-09-20T00:00:00.000Z" }),
        });

        await driven().run();

        expect(store.ledger.warningFor("promised")).not.toBeNull();
        expect(events("sweepPruned")).toEqual([]);
    });

    it("takes decision rows past the window", async () => {
        armed();
        store.ledger.decide({ ...DECISION, passId: "pass-old", at: PAST_30 });
        store.ledger.decide({ ...DECISION, passId: "pass-new", at: WITHIN_30 });

        await driven().run();

        expect(store.ledger.decisionsOn(REPOSITORY, ISSUE).map((row) => row.passId)).toEqual([
            "pass-new",
        ]);
        expect(events("sweepPruned")).toMatchObject([{ deliveries: 0, effects: 0, decisions: 1 }]);
    });

    it("says nothing about retention when a firing took nothing away", async () => {
        armed();
        completed(NEW_DELIVERY, WITHIN_30);

        await driven().run();

        expect(events("sweepPruned")).toEqual([]);
        expect(events("sweepFinished")).toHaveLength(1);
    });

    it("prunes nothing outside a firing", async () => {
        completed(OLD_DELIVERY, PAST_30);

        await driven().run();

        expect(store.inbox.counts()).toMatchObject({ done: 1, oldestDone: PAST_30 });
        expect(logged).toEqual([]);
    });

    it("says so when the store closed under the prune", async () => {
        armed();
        const reader = scriptedReader();
        const { processor } = scriptedProcessor(configFrom(CONFIG_TEXT, CAPABILITIES));
        const sweep = createSweep({
            store,
            capabilities: CAPABILITIES,
            // Closed as the list is read; the prune is the next thing to touch the file.
            processorFor: sweeping(processor, (config) => {
                store.close();
                return reader.facts(config);
            }),
            clock: () => NOW,
            cadenceMs: DAY_MS,
            writeCap: SWEEP_WRITE_CALLS,
            readBudget: SWEEP_READ_REQUESTS,
            requestsMade: () => 0,
            log,
        });

        await sweep.runDue();

        // Twice: the prune's own line, then the re-arm's. One would mean the prune's
        // throw took the re-arm with it.
        expect(events("sweepFailed")).toHaveLength(2);
        expect(events("sweepFinished")).toEqual([]);
    });
});

// ─── The installation switch ─────────────────────────────────────────

/**
 * A suspended firing (D171). It keeps its schedule and its retention, and it
 * makes no GitHub request at all — which is the difference from the kill
 * switch, and why the seams below are wired to fail if they are touched.
 */
describe("a firing under a suspended installation", () => {
    /** A firing may reach neither of these: a suspension reads nothing. */
    const untouchable: Deciding = {
        configuration: () => {
            throw new Error("the configuration was consulted");
        },
        decideItem: () => {
            throw new Error("an item was decided");
        },
    };

    function suspendedSweep(): ReturnType<typeof createSweep> {
        return createSweep({
            store,
            capabilities: CAPABILITIES,
            processorFor: sweeping(untouchable, () => {
                throw new Error("the repository was read");
            }),
            clock: () => NOW,
            cadenceMs: DAY_MS,
            writeCap: SWEEP_WRITE_CALLS,
            readBudget: SWEEP_READ_REQUESTS,
            requestsMade: () => 0,
            suspended: true,
            log,
        });
    }

    it("reads nothing, says so, and arms the next firing anyway", async () => {
        armed();

        await suspendedSweep().runDue();

        expect(events("sweepSuspended")).toEqual([
            { event: "sweepSuspended", scheduleId: SCHEDULE },
        ]);
        // Every seam a reading would have used throws, so silence here is proof.
        expect(events("sweepFailed")).toEqual([]);
        expect(events("sweepFinished")).toMatchObject([
            { scheduleId: SCHEDULE, items: 0, decided: 0, writes: 0, heldBack: 0 },
        ]);
        expect(store.ledger.claimDue(NOW.toISOString())).toEqual([]);
        expect(store.ledger.claimDue(new Date(NOW.getTime() + DAY_MS).toISOString())).toMatchObject(
            [{ scheduleId: SCHEDULE }],
        );
    });

    it("still prunes: a prune is not a decision", async () => {
        armed();
        completed(OLD_DELIVERY, "2026-07-01T00:00:00.000Z");
        completed(NEW_DELIVERY, "2026-09-01T00:00:00.000Z");

        await suspendedSweep().runDue();

        expect(store.inbox.counts()).toMatchObject({
            done: 1,
            oldestDone: "2026-09-01T00:00:00.000Z",
        });
        expect(events("sweepPruned")).toMatchObject([{ deliveries: 1 }]);
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
        const decideItem = createItemDecider({
            store,
            capabilities,
            externals: () => stubbedExternals(),
            repository: REPOSITORY,
        });
        const lane = createDeliveries({
            store,
            capabilities,
            lane: () => ({ configSource, decideItem }),
            repository: REPOSITORY,
            worker: "sweep-1",
            clock: () => NOW,
            log,
        });
        const answers: Decided[] = [];
        const handed: Handed[] = [];
        const record = handedIn(handed);
        const sweep = createSweep({
            store,
            capabilities,
            processorFor: sweeping(
                {
                    configuration: () => lane.configuration(REPOSITORY),
                    decideItem: async (input, config, at, budget) => {
                        record(input, config, at, budget);
                        const answer = await decideItem(input, config, at, budget);
                        answers.push(answer);
                        return answer;
                    },
                },
                (config) =>
                    createFactsReader({
                        http: http.client,
                        repository: REPOSITORY,
                        config,
                        knownCapabilities: [],
                        clock: () => NOW,
                    }),
            ),
            clock: () => NOW,
            cadenceMs: DAY_MS,
            writeCap: SWEEP_WRITE_CALLS,
            readBudget: SWEEP_READ_REQUESTS,
            requestsMade: http.client.requestsMade,
            log,
        });

        await sweep.runDue();

        const codesOf = (answer: Decided): string[] =>
            answer.kind === "decided" ? answer.report.findings.map((finding) => finding.code) : [];
        const [issue, pull] = answers;

        // The pull request's `review` group is built from three reads no
        // protocol has confirmed, so the ladder is skipped rather than guessing.
        expect(handed[1]?.input.facts.item).toEqual(PULL);
        expect(codesOf(pull!)).toEqual(["factsUnread"]);

        // The issue's are both read, so it is judged — and nothing it needs is
        // reported unread. The record it was judged from carries the clocks the
        // timeline and comments dated, and the pull request that closes it.
        expect(handed[0]?.input.facts.item).toEqual(ISSUE);
        expect(codesOf(issue!)).not.toContain("factsUnread");
        const judged = handed[0]?.input.facts;
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
        expect(handed[1]?.input.facts).toMatchObject({
            kind: "pullRequest",
            assignees: [{ login: "ada" }],
            links: { issues: [{ item: ISSUE }] },
            review: UNREAD,
        });
        expect(events("sweepFinished")).toMatchObject([{ items: 2, decided: 2 }]);
    });
});

// ─── The release the platform made itself ────────────────────────────

/**
 * D159. GitHub attributes an `unassigned` event to the ASSIGNEE even when the App
 * made the release, so the item's own journal is the only record that the change
 * was the platform's. `decide()` takes a ONE-argument ordering seam, so the journal
 * is bound to the reader where it is built; unbound, the App's own release reads
 * back as a human change and refuses the next act over it.
 *
 * The reader here is the real one over a recorded timeline and the row is written
 * as the applier writes it, so what the case pins is the binding and nothing else.
 */
describe("an item the platform released within the minute", () => {
    /**
     * The release landed as this firing was reading, which is what makes it bite: the
     * rule compares against the record's own instant, and a tie goes to the human (D33).
     * The same instant twice, because GitHub dates an event to the second and the ledger
     * records in milliseconds; the read-back landed the call 30s later, inside the window.
     */
    const RELEASED_AT = "2026-09-09T12:00:00Z";
    const DECLARED_AT = "2026-09-09T12:00:00.000Z";
    const JOURNAL_CLOSED_AT = "2026-09-09T12:00:30.000Z";

    /**
     * One stale issue whose OTHER assignee the platform released.
     * `bob` is gone from the list because the release landed; the event below is it.
     */
    const RECORDED = {
        "/issues?": [
            {
                number: ISSUE.number,
                state: "open",
                updated_at: "2026-08-01T00:00:00Z",
                labels: [],
                user: { login: "ada" },
                assignees: [{ login: "ada" }],
            },
        ],
        "/issues/12/timeline": [
            {
                event: "assigned",
                actor: { type: "User", login: "ada" },
                assignee: { login: "ada" },
                created_at: "2026-07-01T00:00:00Z",
            },
            {
                event: "unassigned",
                actor: { type: "User", login: "bob" },
                assignee: { login: "bob" },
                created_at: RELEASED_AT,
            },
        ],
        "/issues/12/comments": [
            { user: { login: "ada" }, created_at: "2026-07-02T00:00:00Z", body: "/working" },
        ],
    };

    /** The facts the applier leaves behind for a release it saw through. */
    function journalTheRelease(into: Store): void {
        const fact = {
            effectId: "released-bob",
            seq: 1,
            revision: "rev-sweep-1",
            capability: "inactivity",
            repository: REPOSITORY,
            item: ISSUE,
            verb: "releaseAssignment",
            login: "bob",
            code: null,
            detail: null,
        } as const;
        into.ledger.record({
            ...fact,
            kind: "sent",
            at: DECLARED_AT,
            payload: serializeCall({
                capability: "inactivity",
                item: ISSUE,
                call: { verb: "releaseAssignment", login: "bob" },
            }),
        });
        into.ledger.record({ ...fact, kind: "landed", at: JOURNAL_CLOSED_AT, payload: null });
    }

    /** One firing over `into`, and the codes the issue's decision came to. */
    async function sweptCodes(into: Store): Promise<string[]> {
        into.ledger.schedule(SCHEDULE, DUE_AT, SWEEP_EFFECT);
        const capabilities: readonly EngineCapability[] = [inactivity];
        const http = httpHarness([routed(RECORDED)]);
        const decideItem = createItemDecider({
            store: into,
            capabilities,
            // Live-shaped: the seam the composition root hands down carries the journal.
            externals: () =>
                stubbedExternals({
                    latestHumanChangeAt: orderingEvidenceSource({
                        http: http.client,
                        repository: REPOSITORY,
                        ownWrites: (item) => into.ledger.landedOn(REPOSITORY, item),
                    }),
                }),
            repository: REPOSITORY,
        });
        const lane = createDeliveries({
            store: into,
            capabilities,
            lane: () => ({
                configSource: {
                    load: () =>
                        Promise.resolve({
                            ok: true,
                            document: { revision: "rev-sweep-1", text: CONFIG_TEXT },
                        }),
                },
                decideItem,
            }),
            repository: REPOSITORY,
            worker: "sweep-1",
            clock: () => NOW,
            log,
        });
        const answers: Decided[] = [];
        const sweep = createSweep({
            store: into,
            capabilities,
            processorFor: sweeping(
                {
                    configuration: () => lane.configuration(REPOSITORY),
                    decideItem: async (input, config, at, budget) => {
                        const answer = await decideItem(input, config, at, budget);
                        answers.push(answer);
                        return answer;
                    },
                },
                (config) =>
                    createFactsReader({
                        http: http.client,
                        repository: REPOSITORY,
                        config,
                        knownCapabilities: [],
                        clock: () => NOW,
                    }),
            ),
            clock: () => NOW,
            cadenceMs: DAY_MS,
            writeCap: SWEEP_WRITE_CALLS,
            readBudget: SWEEP_READ_REQUESTS,
            requestsMade: http.client.requestsMade,
            log,
        });

        await sweep.runDue();
        const [answer] = answers;
        expect(answer?.kind, "the swept issue was decided").toBe("decided");
        return answer?.kind === "decided"
            ? answer.report.findings.map((finding) => finding.code)
            : [];
    }

    it("reads its own release off the ledger, and the same event without one as a human's", async () => {
        const journalled = new Store(temp.file("journalled.sqlite"));
        const unjournalled = new Store(temp.file("unjournalled.sqlite"));
        try {
            journalTheRelease(journalled);

            // Recorded rather than acted because the mode is dry-run; what matters is
            // that the ladder got PAST the ordering rule.
            expect(await sweptCodes(journalled)).toEqual([
                "capabilityExplained",
                "modeRecordsOnly",
                "wouldApply",
            ]);
            // The same timeline with no fact behind it: the App's release is a human's.
            expect(await sweptCodes(unjournalled)).toEqual(["newerHumanChange"]);
        } finally {
            journalled.close();
            unjournalled.close();
        }
    });
});
