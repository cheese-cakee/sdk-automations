import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import {
    asDeliveryGuid,
    signBody,
    SIGNATURE_HEADER,
    type LinkedIssueObservation,
    type LinkedIssueReader,
} from "@hiero-hackers/automation-core";
import { Store } from "@hiero-hackers/automation-store";
import { createShell, fileConfigSource, type Shell } from "../src/index.js";
import type { ShellRecord } from "../src/processor.js";
import { Processor } from "../src/processor.js";

const secret = "stage-three-secret";
const guid = "83e4273f-dd89-22f4-92bc-5da478ed1a69";
const repository = { owner: "hiero", repo: "sdk" };
const payload = Buffer.from(
    JSON.stringify({
        action: "opened",
        number: 42,
        repository: { name: "sdk", owner: { login: "hiero" } },
        pull_request: { number: 42, state: "open", closed_at: null },
    }),
);
let directory: string;
let store: Store;
let configFile: string;
beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "linked-issue-"));
    store = new Store(join(directory, "store.sqlite"));
    configFile = join(directory, "config.yml");
});
afterEach(() => {
    vi.restoreAllMocks();
    store.close();
    rmSync(directory, { recursive: true, force: true });
});
function config(mode = "dry-run", enabled = true) {
    writeFileSync(
        configFile,
        `schemaVersion: 1\nmode: ${mode}\ncapabilities:\n  linkedIssue:\n    enabled: ${String(enabled)}\n`,
    );
}
function shell(observation: LinkedIssueObservation): Shell {
    return createShell({
        secret,
        store,
        configSource: fileConfigSource(configFile),
        linkedIssueReader: { read: async () => observation },
        repository,
        clock: () => new Date("2026-08-15T10:00:00.000Z"),
    });
}
async function deliver(target: Shell, body = payload, event = "pull_request") {
    await new Promise<void>((resolve) => target.server.listen(0, resolve));
    try {
        const { port } = target.server.address() as AddressInfo;
        return await fetch(`http://127.0.0.1:${String(port)}/`, {
            method: "POST",
            headers: {
                [SIGNATURE_HEADER]: signBody(secret, body),
                "x-github-delivery": guid,
                "x-github-event": event,
            },
            body,
        });
    } finally {
        await new Promise<void>((resolve, reject) =>
            target.server.close((error) => (error ? reject(error) : resolve())),
        );
    }
}
function record(): ShellRecord {
    const reports = store.deliveryReports();
    expect(reports).toHaveLength(1);
    return JSON.parse(reports[0]!.reportJson) as ShellRecord;
}
function linkedRecord(): Extract<ShellRecord, { readonly kind: "linkedIssue" }> {
    const stored = record();
    if (stored.kind !== "linkedIssue") throw new Error(`expected linkedIssue, got ${stored.kind}`);
    return stored;
}
describe("signed webhook to canonical SQLite report", () => {
    it("durably reports absence and completes atomically", async () => {
        config();
        const target = shell({ outcome: "absent" });
        expect((await deliver(target)).status).toBe(202);
        await target.drain();
        expect(linkedRecord().report).toMatchObject({
            outcome: "advisoryDesired",
            desiredAdvisories: [
                "This pull request is not linked to an issue. Add a closing reference such as `Closes #123`.",
            ],
        });
        expect(
            store.claimNextDelivery(
                "assert",
                "2026-08-15T11:00:00.000Z",
                "2026-08-15T10:59:00.000Z",
            ),
        ).toBeUndefined();
    });
    it.each([
        ["present", "satisfied"],
        ["unknown", "unknown"],
    ] as const)("stores %s truthfully", async (outcome, expected) => {
        config();
        const observation =
            outcome === "unknown"
                ? ({ outcome, reason: "unavailable" } as const)
                : ({ outcome } as const);
        const target = shell(observation);
        await deliver(target);
        await target.drain();
        expect(linkedRecord().report).toMatchObject({ outcome: expected, desiredAdvisories: [] });
    });
    it("does not call the reader when disabled", async () => {
        config("disabled");
        const reader: LinkedIssueReader = { read: vi.fn() };
        const target = createShell({
            secret,
            store,
            configSource: fileConfigSource(configFile),
            linkedIssueReader: reader,
            repository,
        });
        await deliver(target);
        await target.drain();
        expect(reader.read).not.toHaveBeenCalled();
        expect(linkedRecord().report.outcome).toBe("disabled");
    });
    it("rejects active mode before reading", async () => {
        config("active");
        const reader: LinkedIssueReader = { read: vi.fn() };
        const target = createShell({
            secret,
            store,
            configSource: fileConfigSource(configFile),
            linkedIssueReader: reader,
            repository,
        });
        await deliver(target);
        await target.drain();
        expect(reader.read).not.toHaveBeenCalled();
        expect(record()).toMatchObject({ kind: "modeUnsupported" });
    });
    it("fails closed on repository mismatch without reading", async () => {
        config();
        const mismatched = Buffer.from(
            payload.toString().replace('"name":"sdk"', '"name":"other"'),
        );
        const reader: LinkedIssueReader = { read: vi.fn() };
        const target = createShell({
            secret,
            store,
            configSource: fileConfigSource(configFile),
            linkedIssueReader: reader,
            repository,
        });
        await deliver(target, mismatched);
        await target.drain();
        expect(reader.read).not.toHaveBeenCalled();
        expect(linkedRecord().report).toMatchObject({ outcome: "refused", desiredAdvisories: [] });
    });
    it.each([
        ["issues", payload],
        [
            "pull_request",
            Buffer.from(payload.toString().replace('"action":"opened"', '"action":"closed"')),
        ],
    ])("ignores unsupported %s delivery before reading", async (event, body) => {
        config();
        const reader: LinkedIssueReader = { read: vi.fn() };
        const target = createShell({
            secret,
            store,
            configSource: fileConfigSource(configFile),
            linkedIssueReader: reader,
            repository,
        });
        await deliver(target, body, event);
        await target.drain();
        expect(reader.read).not.toHaveBeenCalled();
        expect(linkedRecord().report).toMatchObject({ outcome: "ignored", desiredAdvisories: [] });
    });
    it("records invalid configuration without reading", async () => {
        writeFileSync(
            configFile,
            "schemaVersion: 1\nmode: dry-run\ncapabilities:\n  linkedIssue:\n    enabled: true\n    future: true\n",
        );
        const reader: LinkedIssueReader = { read: vi.fn() };
        const target = createShell({
            secret,
            store,
            configSource: fileConfigSource(configFile),
            linkedIssueReader: reader,
            repository,
        });
        await deliver(target);
        await target.drain();
        expect(reader.read).not.toHaveBeenCalled();
        expect(record()).toMatchObject({ kind: "configRejected" });
    });
    it("cannot commit after losing its Store claim", async () => {
        config();
        store.acceptDelivery({
            deliveryId: asDeliveryGuid(guid)!,
            eventName: "pull_request",
            payload,
            receivedAt: "2026-08-15T09:59:00.000Z",
        });
        const processor = new Processor({
            store,
            configSource: fileConfigSource(configFile),
            linkedIssueReader: {
                read: async () => {
                    expect(store.requeueStuckDeliveries("2026-08-15T10:00:01.000Z")).toEqual([
                        guid,
                    ]);
                    return { outcome: "present" };
                },
            },
            repository,
            worker: "lost-claim-worker",
            clock: () => new Date("2026-08-15T10:00:00.000Z"),
        });
        await expect(processor.processOnce()).rejects.toThrow(
            "delivery report was not committed: notOwned",
        );
        expect(store.deliveryReports()).toEqual([]);
        expect(
            store.claimNextDelivery(
                "next-worker",
                "2026-08-15T10:01:00.000Z",
                "2026-08-15T10:00:59.000Z",
            ),
        ).toBeDefined();
    });
});
