/**
 * A backup taken while the store is open is a store: it opens under the same schema, holds
 * every row the source held at the call, and hands out the pending work the source would.
 * It only reads the source, so it never migrates the file a running process holds.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { asDeliveryGuid, type DeliveryGuid } from "@hiero-hackers/automation-core";
import { useTempDir } from "@hiero-hackers/automation-testkit";
import { backupStoreFile, Store } from "../../src/store/store.js";

const temp = useTempDir("store-backup-");

const guid = (last: string): DeliveryGuid => {
    const held = asDeliveryGuid(`83e4273f-dd89-22f4-92bc-5da478ed1a6${last}`);
    if (held === undefined) throw new Error("invalid test guid");
    return held;
};

const NOW = "2026-10-02T10:00:00.000Z";
const STALE = "2026-10-02T09:00:00.000Z";

function accepted(store: Store, last: string): void {
    store.inbox.acceptDelivery({
        deliveryId: guid(last),
        eventName: "issues",
        payload: Buffer.from(`payload-${last}`),
        receivedAt: NOW,
    });
}

describe("a backup is a store", () => {
    it("opens under the same schema and holds the rows the source held", async () => {
        const sourcePath = temp.file("source.sqlite");
        const copyPath = temp.file("copy.sqlite");
        const source = new Store(sourcePath);
        accepted(source, "0");
        accepted(source, "1");
        await backupStoreFile(sourcePath, copyPath);
        accepted(source, "2");
        source.close();

        const copy = new Store(copyPath);
        expect(copy.inbox.counts()).toMatchObject({ pending: 2, processing: 0, done: 0 });
        copy.close();
    });

    it("hands out the pending work the source would, with the same bytes", async () => {
        const sourcePath = temp.file("source.sqlite");
        const copyPath = temp.file("copy.sqlite");
        const source = new Store(sourcePath);
        accepted(source, "0");
        const fromSource = source.inbox.claimNextDelivery("source", NOW, STALE);
        await backupStoreFile(sourcePath, copyPath);
        source.close();

        const copy = new Store(copyPath);
        const fromCopy = copy.inbox.claimNextDelivery("copy", "2026-10-02T10:10:00.000Z", NOW);
        expect(fromCopy?.deliveryId).toBe(fromSource?.deliveryId);
        expect(fromCopy?.payloadDigest).toBe(fromSource?.payloadDigest);
        copy.close();
    });

    it("replaces an older copy at the path", async () => {
        const sourcePath = temp.file("source.sqlite");
        const copyPath = temp.file("copy.sqlite");
        const source = new Store(sourcePath);
        await backupStoreFile(sourcePath, copyPath);
        accepted(source, "0");
        await backupStoreFile(sourcePath, copyPath);
        source.close();

        const copy = new Store(copyPath);
        expect(copy.inbox.counts().pending).toBe(1);
        copy.close();
    });

    it("refuses a path holding something that is not a database, and leaves it", async () => {
        const sourcePath = temp.file("source.sqlite");
        const other = temp.file("notes.txt");
        new Store(sourcePath).close();
        writeFileSync(other, "not a database");
        await expect(backupStoreFile(sourcePath, other)).rejects.toThrow();
        expect(readFileSync(other, "utf8")).toBe("not a database");
    });

    it("never writes the source: an unmigrated file stays unmigrated", async () => {
        const sourcePath = temp.file("source.sqlite");
        const unmigrated = new DatabaseSync(sourcePath);
        unmigrated.exec("CREATE TABLE note (body TEXT)");
        unmigrated.close();
        const before = readFileSync(sourcePath);

        await backupStoreFile(sourcePath, temp.file("copy.sqlite"));

        expect(readFileSync(sourcePath)).toEqual(before);
    });

    it("refuses a missing source instead of creating an empty store there", async () => {
        const sourcePath = temp.file("missing.sqlite");
        await expect(backupStoreFile(sourcePath, temp.file("copy.sqlite"))).rejects.toThrow();
        expect(existsSync(sourcePath)).toBe(false);
    });
});
