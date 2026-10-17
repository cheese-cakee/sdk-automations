/**
 * The job summary and its annotations, read from a store a real one-shot run decided into.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveManagedMarker, type ReadBack } from "@hiero-hackers/automation-core";
import { capture } from "@hiero-hackers/automation-testkit";
import { hydrateWarnings } from "../../../src/shell/decide/warnings.js";
import {
    parseActionEnvironment,
    runAction,
    runStore,
    type ActionRun,
    type RunOutcome,
} from "../../../src/shell/compose/action.js";
import {
    annotations,
    appendSummary,
    cell,
    renderSummary,
} from "../../../src/shell/observe/summary.js";
import { CONFIGS } from "../compose/journeys.js";
import { scriptedGitHub } from "../compose/scripted-github.js";

const START = new Date("2026-09-15T10:00:00.000Z");

const ENVIRONMENT = {
    GITHUB_REPOSITORY: "scrubbed-1/scrubbed-2",
    GITHUB_EVENT_NAME: "issues",
    GITHUB_EVENT_PATH: "/tmp/event.json",
    INPUT_TOKEN: "runner-token",
    GITHUB_RUN_ID: "42",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_SERVER_URL: "https://github.com",
};

const configFor = (capability: string, mode = "dry-run"): string => `schemaVersion: 2
mode: ${mode}
capabilities:
${CONFIGS[capability] ?? ""}mappings:
  labels:
    awaitingTriage: "status: triage"
  commands:
    assign: /assign
    unassign: /unassign
    working: /working
`;

afterEach(() => {
    vi.unstubAllGlobals();
});

function runOf(overrides: Partial<ActionRun> = {}): ActionRun {
    const parsed = parseActionEnvironment(ENVIRONMENT);
    if (!parsed.ok) throw new Error(parsed.errors.join("; "));
    return { ...parsed.run, ...overrides };
}

async function decided(
    run: ActionRun,
    mode: string,
): Promise<{ store: ReturnType<typeof runStore>; outcome: RunOutcome }> {
    scriptedGitHub({ now: () => START, config: () => configFor("triageQueue", mode) });
    const store = runStore();
    const outcome = await runAction(run, {
        payload: capture("issues.opened.json").bytes(),
        store,
        clock: () => START,
        log: () => undefined,
    });
    return { store, outcome };
}

describe("the job summary", () => {
    it("names the repository, event and item, and lists the decision rows", async () => {
        const run = runOf();
        const { store, outcome } = await decided(run, "dry-run");
        const text = renderSummary(store, run, outcome);
        expect(text).toContain("scrubbed-1/scrubbed-2");
        expect(text).toContain("issues");
        expect(text).toContain("delivery");
        expect(text).toContain("issue#164");
        expect(text.match(/modeRecordsOnly/g)).toHaveLength(2);
        expect(text).not.toContain("dry-run because");
        expect(annotations(outcome)).toEqual([]);
        store.close();
    });

    it("says active was decided as dry-run when writes were not armed", async () => {
        const run = runOf({ armWrites: false });
        const { store, outcome } = await decided(run, "active");
        const text = renderSummary(store, run, outcome);
        expect(text).toContain("dry-run");
        expect(text).toContain("did not arm writes");
        expect(annotations(outcome)[0]).toMatch(/^::notice::/);
        expect(annotations(outcome)).toHaveLength(1);
        store.close();
    });

    it("closes with the event that made the run exit non-zero", async () => {
        const run = runOf({ repository: { owner: "other", repo: "place" } });
        const { store, outcome } = await decided(run, "dry-run");
        expect(outcome.exitCode).toBe(1);
        const text = renderSummary(store, run, outcome);
        expect(text).toContain("exited non-zero");
        expect(text).toContain("repositoryMismatch");
        const lines = annotations(outcome);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatch(/^::warning::deliveryCompleted \(repositoryMismatch\)/);
        store.close();
    });
});

describe("appendSummary", () => {
    it("lists an effect that stands on the item, and carries a failure's detail", async () => {
        const store = runStore();
        const item = { kind: "issue", number: 12 } as const;
        const repository = { owner: "scrubbed-1", repo: "scrubbed-2" } as const;
        const marker = deriveManagedMarker(
            { capability: "inactivity", item, kind: "warning", topic: "ada" },
            {
                effectId: "planted",
                actionClass: "clockTriggeredDestructive",
                capability: "inactivity",
                causeObservedAt: "2026-09-14T10:00:00.000Z",
                cause: "assignmentWentStale",
                item: "scrubbed-1/scrubbed-2#12",
                change: "release ada",
                gracePeriodHours: 168,
                cancelledBy: "a /working comment",
                reversesWith: "re-assign",
            },
        );
        await hydrateWarnings({
            ledger: store.ledger,
            reader: {
                comments: () =>
                    Promise.resolve({
                        ok: true,
                        value: [
                            {
                                id: 1,
                                body: marker,
                                authoredByApp: true,
                                createdAt: "2026-09-14T12:00:00Z",
                            },
                        ],
                    }),
            } as unknown as ReadBack,
            repository,
            item,
            revision: "rev-1",
        });
        const outcome: RunOutcome = {
            kind: "delivery",
            events: [
                {
                    event: "deliveryAttemptFailed",
                    deliveryId: "d",
                    disposition: "retryScheduled",
                    attempts: 1,
                    maxAttempts: 5,
                    retryNotBefore: null,
                    detail: "GitHub answered 502",
                },
            ],
            items: [item, item],
            modeLowered: false,
            exitCode: 1,
        };
        const text = renderSummary(
            store,
            { repository, eventName: "schedule", runUrl: null },
            outcome,
        );
        expect(text).toContain("| planted |");
        expect(text.match(/### issue#12/g)).toHaveLength(1);
        expect(text).toContain("`deliveryAttemptFailed`, GitHub answered 502.");
        expect(annotations(outcome)).toEqual([
            "::warning::deliveryAttemptFailed GitHub answered 502",
        ]);
        store.close();
    });

    it("escapes a cell so no value can close it, and spells an empty one as a dash", () => {
        expect(cell(null)).toBe("-");
        expect(cell("")).toBe("-");
        expect(cell(3)).toBe("3");
        expect(cell("a|b\\c\n d")).toBe("a\\|b\\\\c d");
    });

    it("names a dead-lettered delivery without a detail, in the line and the warning", () => {
        const store = runStore();
        const outcome: RunOutcome = {
            kind: "delivery",
            events: [{ event: "deliveryDeadLettered", deliveryId: "d", attempts: 5 }],
            items: [],
            modeLowered: false,
            exitCode: 1,
        };
        const repository = { owner: "o", repo: "r" } as const;
        const text = renderSummary(
            store,
            { repository, eventName: "issues", runUrl: null },
            outcome,
        );
        expect(text).toContain("The run exited non-zero: `deliveryDeadLettered`.");
        expect(annotations(outcome)).toEqual(["::warning::deliveryDeadLettered"]);
        store.close();
    });

    it("closes with no cause when a non-zero run logged none it recognises", () => {
        const store = runStore();
        const outcome: RunOutcome = {
            kind: "idle",
            events: [{ event: "deliveryCompleted", deliveryId: "d", kind: "decision" }],
            items: [],
            modeLowered: false,
            exitCode: 1,
        };
        const repository = { owner: "o", repo: "r" } as const;
        const text = renderSummary(
            store,
            { repository, eventName: "schedule", runUrl: null },
            outcome,
        );
        expect(text).not.toContain("exited non-zero");
        expect(annotations(outcome)).toEqual([]);
        store.close();
    });

    it("writes nothing without a path and appends with one", () => {
        const dir = mkdtempSync(join(tmpdir(), "summary-"));
        try {
            const file = join(dir, "step-summary.md");
            writeFileSync(file, "first\n");
            appendSummary(undefined, "ignored\n");
            expect(readFileSync(file, "utf8")).toBe("first\n");
            appendSummary(file, "second\n");
            expect(readFileSync(file, "utf8")).toBe("first\nsecond\n");
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
