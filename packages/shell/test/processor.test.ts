/**
 * The worker's failure honesty: a crash mid-decision RELEASES the claim —
 * the delivery stays durable and the next drain retries it — and a
 * completed delivery never runs twice. The receiver acknowledged long
 * before any of this; GitHub is not watching.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { asDeliveryGuid, toEngine, type EngineCapability } from "@hiero-hackers/automation-core";
import { Store } from "@hiero-hackers/automation-store";
import { intake, intakeDeclaration } from "@hiero-hackers/automation-probes";
import { capture, useTempDir } from "@hiero-hackers/automation-testkit";
import { Processor } from "../src/processor.js";
import { stubbedExternals } from "../src/externals.js";
import type { ConfigSource } from "../src/config.js";

const GUID = asDeliveryGuid("94f5384a-ee9a-33a5-a3cd-6eb589fe2b7a")!;
const SECOND_GUID = asDeliveryGuid("94f5384a-ee9a-33a5-a3cd-6eb589fe2b7b")!;
const FIXTURE = capture("issues.opened.json").bytes();

const CONFIG_TEXT = `schemaVersion: 1
mode: dry-run
capabilities:
  intake:
    enabled: true
    settings:
      announce: false
`;
const configSource: ConfigSource = {
    load: async () => ({ revision: "rev-test-1", text: CONFIG_TEXT }),
};

const BASE = new Date("2026-08-07T10:00:00.000Z");

const temp = useTempDir("shell-processor-");
let store: Store;
beforeEach(() => {
    store = new Store(temp.file("store.sqlite"));
    store.acceptDelivery({
        deliveryId: GUID,
        eventName: "issues",
        payload: FIXTURE,
        receivedAt: BASE.toISOString(),
    });
});
afterEach(() => {
    store.close();
});

function processor(capability: EngineCapability, firstTickMs = 1_000) {
    let tick = 0;
    return new Processor({
        store,
        capabilities: [capability],
        configSource,
        externals: stubbedExternals(),
        repository: { owner: "owner-sandbox", repo: "automation-sandbox" },
        worker: "test-worker",
        clock: () => new Date(BASE.getTime() + firstTickMs + 1000 * tick++),
    });
}

function records(): Record<string, unknown>[] {
    return store
        .deliveryReports()
        .map((report) => JSON.parse(report.reportJson) as Record<string, unknown>);
}

describe("a crash releases the claim", () => {
    it("the delivery survives its processor and is retried by the next one", async () => {
        const bomb: EngineCapability = {
            declaration: intakeDeclaration,
            evaluate: async () => {
                throw new Error("capability exploded");
            },
        };
        const failing = processor(bomb);
        await expect(failing.processOnce()).rejects.toThrow("capability exploded");
        expect(records()).toEqual([]);

        // Released, not stuck: a fresh worker claims it immediately —
        // no stale-claim wait — and carries it to a decision.
        const healthy = processor(toEngine(intake));
        expect(await healthy.processOnce()).toBe(true);
        expect(records()).toEqual([
            expect.objectContaining({
                kind: "decision",
                deliveryId: GUID as string,
                configRevision: "rev-test-1",
            }),
        ]);
    });

    it("an empty queue reports itself instead of pretending to work", async () => {
        const healthy = processor(toEngine(intake));
        expect(await healthy.processOnce()).toBe(true);
        expect(await healthy.processOnce()).toBe(false);
        expect(records()).toHaveLength(1);
    });

    it("does not steal a fresh claim but takes over after the 15-minute lease", async () => {
        expect(
            store.claimNextDelivery(
                "stalled-worker",
                new Date(BASE.getTime() + 60_000).toISOString(),
                new Date(BASE.getTime() - 60_000).toISOString(),
            ),
        ).toBeDefined();

        const fresh = processor(toEngine(intake), 10 * 60_000);
        expect(await fresh.processOnce()).toBe(false);
        expect(records()).toEqual([]);

        const stale = processor(toEngine(intake), 16 * 60_000);
        expect(await stale.processOnce()).toBe(true);
        expect(records()).toHaveLength(1);
    });

    it("starts a new drain after the previous queue became empty", async () => {
        const healthy = processor(toEngine(intake));
        await healthy.drain();
        expect(records()).toHaveLength(1);

        store.acceptDelivery({
            deliveryId: SECOND_GUID,
            eventName: "issues",
            payload: FIXTURE,
            receivedAt: new Date(BASE.getTime() + 10_000).toISOString(),
        });
        await healthy.drain();
        expect(records()).toHaveLength(2);
    });

    it("does not persist or complete after its delivery claim is released", async () => {
        const lostClaim: EngineCapability = {
            declaration: intakeDeclaration,
            evaluate: async () => {
                expect(store.requeueStuckDeliveries("2026-08-07T10:00:01.000Z")).toEqual([GUID]);
                return [];
            },
        };
        const candidate = processor(lostClaim);

        await expect(candidate.processOnce()).rejects.toThrow(
            "delivery report was not committed: notOwned",
        );
        expect(records()).toEqual([]);
        expect(
            store.claimNextDelivery(
                "next-worker",
                "2026-08-07T10:01:00.000Z",
                "2026-08-07T09:00:00.000Z",
            ),
        ).toBeDefined();
    });
});
