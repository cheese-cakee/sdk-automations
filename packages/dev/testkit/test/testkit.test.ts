/**
 * The testkit's own guarantees. Nothing here kills a mutant — there is no
 * mutated source in this package — so what these tests are for is narrower
 * and worth saying: they stop the FIXTURES from rotting silently. A capture
 * that stopped parsing, a filename whose event prefix drifted from its
 * declared `event`, a `withTempDir` that leaks on the throwing path, or a
 * `useTempDir` that hands two tests the same directory would all be
 * invisible from the packages that consume them.
 */

import { describe, expect, it } from "vitest";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WEBHOOK_CAPTURES, capture, useTempDir, withTempDir } from "../src/index.js";

describe("every captured payload is readable evidence", () => {
    it("holds the whole 7.1 session", () => {
        // Vacuity guard: an empty array would pass every `it.each` below.
        expect(WEBHOOK_CAPTURES.length).toBeGreaterThanOrEqual(5);
    });

    it.each(WEBHOOK_CAPTURES.map((subject) => [subject.name, subject] as const))(
        "%s parses into an object",
        (_name, subject) => {
            const payload = subject.json();
            expect(typeof payload).toBe("object");
            expect(payload).not.toBeNull();
            expect(subject.bytes().length).toBeGreaterThan(0);
        },
    );

    it.each(WEBHOOK_CAPTURES.map((subject) => [subject.name, subject] as const))(
        "%s declares the event its filename names",
        (name, subject) => {
            expect(subject.event).toBe(name.split(".")[0]);
            expect(subject.event.length).toBeGreaterThan(0);
        },
    );

    it.each(WEBHOOK_CAPTURES.map((subject) => [subject.name, subject] as const))(
        "%s carries its provenance",
        (_name, subject) => {
            expect(subject.capturedAt).not.toBe("");
            expect(subject.protocol).not.toBe("");
            expect(subject.synthetic).toBe(false);
        },
    );
});

describe("a fixture is asked for by name", () => {
    it("returns the capture whose name matches", () => {
        expect(capture("issues.opened.json").event).toBe("issues");
    });

    it("names the alternatives when the name is wrong", () => {
        // The failure a typo deserves: the list, not ENOENT from three
        // stack frames away in `readFileSync`.
        expect(() => capture("nope.json")).toThrow(/issues\.opened\.json/);
        expect(() => capture("nope.json")).toThrow(/pull_request\.closed\.json/);
    });
});

describe("a temporary directory does not outlive its block", () => {
    it("gives the callback a real directory and removes it after", () => {
        let seen = "";
        const returned = withTempDir("testkit-check-", (dir) => {
            seen = dir;
            writeFileSync(join(dir, "file"), "content");
            expect(existsSync(dir)).toBe(true);
            return 42;
        });
        expect(returned).toBe(42);
        expect(existsSync(seen)).toBe(false);
    });

    it("removes the directory even when the callback throws", () => {
        let seen = "";
        expect(() =>
            withTempDir("testkit-check-", (dir) => {
                seen = dir;
                writeFileSync(join(dir, "file"), "content");
                throw new Error("boom");
            }),
        ).toThrow("boom");
        expect(seen).not.toBe("");
        expect(existsSync(seen)).toBe(false);
    });

    /**
     * The trap this helper would otherwise set: a `finally` fires when an
     * async callback RETURNS, not when it finishes, so the directory would
     * vanish mid-test. Asserting existence from INSIDE the awaited body is
     * what makes this fail against that version — a check that the block
     * merely cleans up eventually passes either way.
     */
    it("keeps the directory alive until an async callback settles", async () => {
        let seen = "";
        let survivedTheAwait = false;
        const returned = await withTempDir("testkit-check-", async (dir) => {
            seen = dir;
            writeFileSync(join(dir, "file"), "content");
            await new Promise((resolve) => setTimeout(resolve, 10));
            survivedTheAwait = existsSync(dir);
            return 42;
        });
        expect(returned).toBe(42);
        expect(survivedTheAwait).toBe(true);
        expect(existsSync(seen)).toBe(false);
    });

    it("removes the directory when an async callback rejects", async () => {
        let seen = "";
        await expect(
            withTempDir("testkit-check-", async (dir) => {
                seen = dir;
                await new Promise((resolve) => setTimeout(resolve, 10));
                throw new Error("async boom");
            }),
        ).rejects.toThrow("async boom");
        expect(seen).not.toBe("");
        expect(existsSync(seen)).toBe(false);
    });

    it("removes the directory when thenable assimilation throws synchronously", () => {
        let seen = "";
        const brokenThenable = {
            then() {
                throw new Error("thenable boom");
            },
        };
        expect(() =>
            withTempDir("testkit-check-", (dir) => {
                seen = dir;
                writeFileSync(join(dir, "file"), "content");
                return brokenThenable;
            }),
        ).toThrow("thenable boom");
        expect(seen).not.toBe("");
        expect(existsSync(seen)).toBe(false);
    });
});

/**
 * The hooked form's one guarantee that no single test can state: the SECOND
 * test must see a different, empty directory, and the first one's must be
 * gone. Tests in a file run in order, so the handshake through `firstDir`
 * is what turns two tests into that one assertion.
 */
describe("a hooked temporary directory is fresh for every test", () => {
    const temp = useTempDir("testkit-hook-");
    let firstDir = "";

    it("exists, and holds what the test writes into it", () => {
        firstDir = temp.dir;
        expect(existsSync(firstDir)).toBe(true);
        writeFileSync(temp.file("file"), "content");
        expect(existsSync(temp.file("file"))).toBe(true);
    });

    it("is a different directory by the next test, and the old one is gone", () => {
        expect(firstDir).not.toBe("");
        expect(existsSync(firstDir)).toBe(false);
        expect(temp.dir).not.toBe(firstDir);
        expect(existsSync(temp.dir)).toBe(true);
        expect(existsSync(temp.file("file"))).toBe(false);
    });

    it("joins names onto the directory of the running test", () => {
        expect(temp.file("nested.sqlite")).toBe(join(temp.dir, "nested.sqlite"));
    });
});
