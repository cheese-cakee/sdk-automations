/**
 * The worker's failure honesty: a crash mid-decision RELEASES the claim —
 * the delivery stays durable and the next drain retries it — and a
 * completed delivery never runs twice. The receiver acknowledged long
 * before any of this; GitHub is not watching.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asDeliveryGuid, toEngine, type EngineCapability } from "@hiero-hackers/automation-core";
import { Store } from "@hiero-hackers/automation-store";
import { intake, intakeDeclaration } from "@hiero-hackers/automation-probes";
import { Processor } from "../src/processor.js";
import { memoryReportSink } from "../src/reports.js";
import { stubbedExternals } from "../src/externals.js";
import type { ConfigSource } from "../src/config.js";

const GUID = asDeliveryGuid("94f5384a-ee9a-33a5-a3cd-6eb589fe2b7a")!;
const SECOND_GUID = asDeliveryGuid("94f5384a-ee9a-33a5-a3cd-6eb589fe2b7b")!;
const FIXTURE = readFileSync(
    new URL(
        "../test/github/fixtures/issues.opened.json",
        import.meta.resolve("@hiero-hackers/automation-core"),
    ),
);

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

let dir: string;
let store: Store;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "shell-processor-"));
    store = new Store(join(dir, "store.sqlite"));
    store.acceptDelivery({
        deliveryId: GUID,
        eventName: "issues",
        payload: FIXTURE,
        receivedAt: BASE.toISOString(),
    });
});
afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
});

function processor(capability: EngineCapability, firstTickMs = 1_000) {
    const reports = memoryReportSink();
    let tick = 0;
    return {
        reports,
        processor: new Processor({
            store,
            capabilities: [capability],
            configSource,
            reports,
            externals: stubbedExternals(),
            repository: { owner: "owner-sandbox", repo: "automation-sandbox" },
            worker: "test-worker",
            clock: () => new Date(BASE.getTime() + firstTickMs + 1000 * tick++),
            onProjectionFailure: () => {},
        }),
    };
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
        await expect(failing.processor.processOnce()).rejects.toThrow("capability exploded");
        expect(failing.reports.entries).toEqual([]);

        // Released, not stuck: a fresh worker claims it immediately —
        // no stale-claim wait — and carries it to a decision.
        const healthy = processor(toEngine(intake));
        expect(await healthy.processor.processOnce()).toBe(true);
        expect(healthy.reports.entries).toHaveLength(1);
        expect(healthy.reports.entries[0]).toMatchObject({
            kind: "decision",
            deliveryId: GUID as string,
            configRevision: "rev-test-1",
        });
        healthy.reports.entries.splice(0);
        healthy.reports.rebuild(store.deliveryReports());
        expect(healthy.reports.entries).toEqual([
            expect.objectContaining({
                kind: "decision",
                deliveryId: GUID as string,
                configRevision: "rev-test-1",
            }),
        ]);
    });

    it("an empty queue reports itself instead of pretending to work", async () => {
        const healthy = processor(toEngine(intake));
        expect(await healthy.processor.processOnce()).toBe(true);
        expect(await healthy.processor.processOnce()).toBe(false);
        expect(healthy.reports.entries).toHaveLength(1);
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
        expect(await fresh.processor.processOnce()).toBe(false);
        expect(fresh.reports.entries).toEqual([]);

        const stale = processor(toEngine(intake), 16 * 60_000);
        expect(await stale.processor.processOnce()).toBe(true);
        expect(stale.reports.entries).toHaveLength(1);
    });

    it("starts a new drain after the previous queue became empty", async () => {
        const healthy = processor(toEngine(intake));
        await healthy.processor.drain();
        expect(healthy.reports.entries).toHaveLength(1);

        store.acceptDelivery({
            deliveryId: SECOND_GUID,
            eventName: "issues",
            payload: FIXTURE,
            receivedAt: new Date(BASE.getTime() + 10_000).toISOString(),
        });
        await healthy.processor.drain();
        expect(healthy.reports.entries).toHaveLength(2);
    });

    it("does not project or complete after its delivery claim is released", async () => {
        const lostClaim: EngineCapability = {
            declaration: intakeDeclaration,
            evaluate: async () => {
                expect(store.requeueStuckDeliveries("2026-08-07T10:00:01.000Z")).toEqual([GUID]);
                return [];
            },
        };
        const candidate = processor(lostClaim);

        await expect(candidate.processor.processOnce()).rejects.toThrow(
            "delivery report was not committed: notOwned",
        );
        expect(candidate.reports.entries).toEqual([]);
        expect(
            store.claimNextDelivery(
                "next-worker",
                "2026-08-07T10:01:00.000Z",
                "2026-08-07T09:00:00.000Z",
            ),
        ).toBeDefined();
        const db = (
            store as unknown as {
                db: {
                    prepare(sql: string): { get(): Record<string, unknown> };
                };
            }
        ).db;
        expect(db.prepare("SELECT count(*) AS reports FROM delivery_report").get()).toEqual({
            reports: 0,
        });
    });

    it("a projection append failure rebuilds from canonical reports and does not release", async () => {
        let tick = 0;
        const projectionFailure = new Error("projection unavailable");
        const rebuilt: string[][] = [];
        const unresolved = vi.fn();
        const candidate = new Processor({
            store,
            capabilities: [toEngine(intake)],
            configSource,
            reports: {
                record: () => {
                    throw projectionFailure;
                },
                rebuild: (reports) => {
                    rebuilt.push(reports.map((report) => report.reportJson));
                },
            },
            externals: stubbedExternals(),
            repository: { owner: "owner-sandbox", repo: "automation-sandbox" },
            worker: "test-worker",
            clock: () => new Date(BASE.getTime() + 1_000 * ++tick),
            onProjectionFailure: unresolved,
        });

        await expect(candidate.processOnce()).resolves.toBe(true);
        expect(rebuilt).toEqual([store.deliveryReports().map((report) => report.reportJson)]);
        expect(unresolved).not.toHaveBeenCalled();
        expect(
            store.claimNextDelivery(
                "next-worker",
                "2026-08-07T11:00:00.000Z",
                "2026-08-07T10:59:00.000Z",
            ),
        ).toBeUndefined();
        const db = (
            store as unknown as {
                db: {
                    prepare(sql: string): { get(): Record<string, unknown> };
                };
            }
        ).db;
        expect(
            db
                .prepare(
                    `
            SELECT count(*) AS reports FROM delivery_report
        `,
                )
                .get(),
        ).toEqual({ reports: 1 });
    });

    it("a persistent projection failure is reported but does not stop the drain", async () => {
        store.acceptDelivery({
            deliveryId: SECOND_GUID,
            eventName: "issues",
            payload: FIXTURE,
            receivedAt: new Date(BASE.getTime() + 500).toISOString(),
        });
        let tick = 0;
        const failures: unknown[] = [];
        const candidate = new Processor({
            store,
            capabilities: [toEngine(intake)],
            configSource,
            reports: {
                record: () => {
                    throw new Error("append unavailable");
                },
                rebuild: () => {
                    throw new Error("rebuild unavailable");
                },
            },
            externals: stubbedExternals(),
            repository: { owner: "owner-sandbox", repo: "automation-sandbox" },
            worker: "test-worker",
            clock: () => new Date(BASE.getTime() + 1_000 * ++tick),
            onProjectionFailure: (error) => {
                failures.push(error);
                throw new Error("operator logger unavailable");
            },
        });

        await expect(candidate.drain()).resolves.toBeUndefined();
        expect(store.deliveryReports()).toHaveLength(2);
        expect(failures).toHaveLength(2);
        for (const failure of failures) {
            expect(failure).toBeInstanceOf(AggregateError);
            expect((failure as AggregateError).message).toBe(
                "report projection failed and its canonical replay did not complete",
            );
            expect((failure as AggregateError).errors).toEqual([
                expect.objectContaining({ message: "append unavailable" }),
                expect.objectContaining({ message: "rebuild unavailable" }),
            ]);
        }
    });
});
