/**
 * The action-journeys matrix with `fetch` unstubbed, the composition reaching the fake GitHub over
 * HTTP at the origin the environment names as `GITHUB_API_URL`.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { type EngineCapability } from "@hiero-hackers/automation-core";
import { CAPABILITIES } from "@hiero-hackers/automation-capabilities";
import {
    CONFIGS,
    configFor,
    JOURNEYS,
    capture,
    startFakeGitHub,
    WEBHOOK_CAPTURES,
    type FakeGitHub,
    type Row,
} from "@hiero-hackers/automation-testkit";
import { parseActionEnvironment } from "../../../src/shell/compose/action/inputs.js";
import { runAction, runStore } from "../../../src/shell/compose/action/run.js";

const START = new Date("2026-09-15T10:00:00.000Z");

let fake: FakeGitHub;
let config = "";

beforeAll(async () => {
    fake = await startFakeGitHub({ now: () => START, config: () => config });
});

afterAll(async () => {
    await fake.close();
});

afterEach(() => {
    fake.secondaryLimit(false);
});

/** Run one capture as an action for one capability alone; answer the rows held about its item. */
async function journey(capability: EngineCapability, name: string): Promise<Row[]> {
    const held = capture(name);
    const payload = held.json() as {
        issue?: { number: number };
        pull_request?: { number: number };
        repository: { name: string; full_name: string; owner: { login: string } };
    };
    const number = (payload.issue ?? payload.pull_request)?.number;
    if (number === undefined) throw new Error(`${name} names no item`);
    const repository = { owner: payload.repository.owner.login, repo: payload.repository.name };
    const item = { kind: held.event === "pull_request" ? "pullRequest" : "issue", number } as const;
    const parsed = parseActionEnvironment({
        GITHUB_REPOSITORY: payload.repository.full_name,
        GITHUB_EVENT_NAME: held.event,
        GITHUB_EVENT_PATH: "/tmp/event.json",
        INPUT_TOKEN: "runner-token",
        GITHUB_RUN_ID: "42",
        GITHUB_RUN_ATTEMPT: "1",
        GITHUB_SERVER_URL: "https://github.com",
        GITHUB_API_URL: fake.origin,
    });
    if (!parsed.ok) throw new Error(parsed.errors.join("; "));
    config = configFor(capability.declaration.name);
    const store = runStore();
    try {
        const outcome = await runAction(parsed.run, {
            payload: held.bytes(),
            store,
            clock: () => START,
            log: () => undefined,
            capabilities: [capability],
        });
        expect(outcome.exitCode, `${capability.declaration.name} × ${name} exit`).toBe(0);
        expect(
            outcome.events.find((event) => event.event === "deliveryCompleted"),
            `${capability.declaration.name} × ${name} completed`,
        ).toMatchObject({ kind: "decision" });
        expect(outcome.items).toContainEqual(item);
        return store.ledger
            .decisionsOn(repository, item)
            .map(({ capability: by, verdict, code }) => ({ capability: by, verdict, code }))
            .sort((a, b) =>
                `${a.capability}${a.verdict}${a.code}`.localeCompare(
                    `${b.capability}${b.verdict}${b.code}`,
                ),
            );
    } finally {
        store.close();
    }
}

const names = CAPABILITIES.map((held) => held.declaration.name);

describe("the table covers the registry", () => {
    it("has a config for every shipped capability and no other", () => {
        expect(Object.keys(CONFIGS).sort()).toEqual([...names].sort());
    });
});

describe.each(CAPABILITIES.map((held) => [held.declaration.name, held] as const))(
    "%s decides every captured delivery as its cells say, over HTTP",
    (name, capability) => {
        it.each(WEBHOOK_CAPTURES.map((held) => held.name))("%s", async (captureName) => {
            const rows = await journey(capability, captureName);
            expect(rows).toEqual(JOURNEYS[name]?.[captureName] ?? []);
        });
    },
);

describe("the matrix was not vacuous", () => {
    it("reached the fake over HTTP", () => {
        expect(fake.calls.length).toBeGreaterThan(0);
    });
});
