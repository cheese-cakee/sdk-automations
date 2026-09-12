/**
 * The seam the real GitHub adapter will replace. Until it exists the shell
 * runs on stated sandbox facts, so the test that matters is that every one
 * of them is overridable through the one seam — a stub that cannot be
 * replaced is a fact hard-coded twice.
 */

import { describe, expect, it } from "vitest";
import { useTempDir } from "@hiero-hackers/automation-testkit";
import {
    credentialFreeResolvers,
    recordedWarningsIn,
    stubbedExternals,
} from "../../src/shell/externals.js";
import { Store, type StoredWarning } from "../../src/store/index.js";

describe("first-slice external facts", () => {
    it("defaults to the documented sandbox facts", () => {
        const externals = stubbedExternals();
        expect(externals.killSwitchActive).toBe(false);
        expect(externals.installationGrants).toEqual(["issues:write"]);
        expect(externals.latestHumanChangeAt({ kind: "issue", number: 1 })).toBeNull();
    });

    it("lets the real adapter replace every stub through one seam", () => {
        const latestHumanChangeAt = () => "unknown" as const;
        const externals = stubbedExternals({
            killSwitchActive: true,
            installationGrants: [],
            latestHumanChangeAt,
        });
        expect(externals).toEqual({
            killSwitchActive: true,
            installationGrants: [],
            latestHumanChangeAt,
            resolve: expect.any(Function),
        });
    });

    /**
     * D3, as the four end-to-end tests that found it would have put it: a
     * resolver the platform can answer without talking to anybody is one it
     * must answer, or every capability that declares it is silent on this path
     * — and silent CORRECTLY, since a lookup that could not answer may never
     * be read as a negative one (D51).
     */
    it("answers the credential-free resolver, and only that one", async () => {
        const resolve = credentialFreeResolvers();

        await expect(resolve("isAutomationActor", { login: "app[bot]" })).resolves.toEqual({
            ok: true,
            value: true,
        });
        await expect(resolve("isAutomationActor", { login: "ada" })).resolves.toEqual({
            ok: true,
            value: false,
        });
        // A login it cannot read is unavailable, never a `false` that would
        // exempt nobody and expose everybody.
        await expect(resolve("isAutomationActor", { login: "" })).resolves.toMatchObject({
            ok: false,
            reason: "unavailable",
        });
        await expect(
            resolve("linkedIssues", { item: { kind: "pullRequest", number: 1 } }),
        ).resolves.toMatchObject({
            ok: false,
            reason: "unavailable",
            detail: expect.stringContaining("needs App credentials"),
        });
    });
});

/**
 * The recorded warning, read back and re-minted (grace.md §2).
 *
 * The store holds bytes; `createDestructiveWarning` is the only constructor,
 * so a row becomes authority by passing back through it. What matters here is
 * that the snapshot survives the round trip intact — the door matches it
 * against the request it is asked about, and a field lost in the reader would
 * widen what the warning authorizes.
 */
describe("the recorded warning a decision reads", () => {
    const temp = useTempDir("shell-externals-");

    const stored: StoredWarning = {
        effectId: "act-1",
        warnedAt: "2026-09-01T00:00:00.000Z",
        gracePeriodDays: 7,
        earliestActionAt: "2026-09-08T00:00:00.000Z",
        cancelledBy: "a commit or a /working comment",
        reversesWith: "re-assign / reopen",
        actionClass: "clockTriggeredDestructive",
        capability: "inactivity",
        causeObservedAt: "2026-08-01T00:00:00.000Z",
        cause: "assignmentWentStale",
        item: "o/r#40",
        change: "release alice",
    };

    it("answers null for an act nobody warned, and the promise for one warned", () => {
        const store = new Store(temp.file("store.sqlite"));
        const warningFor = recordedWarningsIn(store);

        expect(warningFor("act-1")).toBeNull();
        store.recordWarning(stored);

        const warning = warningFor("act-1");
        expect(warning).toMatchObject({
            warnedAtMs: Date.parse(stored.warnedAt),
            gracePeriodDays: 7,
            earliestActionAtMs: Date.parse(stored.earliestActionAt),
            cancelledBy: stored.cancelledBy,
            reversesWith: stored.reversesWith,
            requestSnapshot: {
                actionClass: "clockTriggeredDestructive",
                capability: "inactivity",
                causeObservedAtMs: Date.parse(stored.causeObservedAt),
                cause: "assignmentWentStale",
                item: "o/r#40",
                change: "release alice",
            },
        });
        store.close();
    });

    /**
     * The door is the one place that decides what a warning must look like, so
     * a row whose instants no longer parse re-mints to `NaN` and is refused
     * there rather than being second-guessed by the reader.
     */
    it("re-mints an unreadable instant as one the door refuses", () => {
        const store = new Store(temp.file("broken.sqlite"));
        store.recordWarning(stored);
        (store as unknown as { db: { exec(sql: string): void } }).db.exec(
            "UPDATE destructive_warning SET warned_at = 'whenever'",
        );

        expect(recordedWarningsIn(store)("act-1")?.warnedAtMs).toBeNaN();
        store.close();
    });
});
