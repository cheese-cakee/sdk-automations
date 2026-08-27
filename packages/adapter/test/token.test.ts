/**
 * The cache, the early refresh and the single flight, all driven by a fake
 * clock: no test here waits on real time or touches the network.
 *
 * Every mint is counted, because "did not call GitHub again" is the whole
 * claim of this file.
 */

import { describe, expect, it } from "vitest";
import {
    createTokenSource,
    grantsFromPermissions,
    isDueForRefresh,
    isPastExpiry,
    MINT_FLOOR_SECONDS,
    MINT_RETRY_COOLDOWN_SECONDS,
    REFRESH_SKEW_SECONDS,
    type TokenOutcome,
} from "../src/token.js";
import {
    credentials,
    HOUR_MS,
    installationToken as token,
    TEST_NOW as START,
    tokenHarness as harness,
} from "./harness.js";

const minted = (value: string, expiresAt: Date): TokenOutcome => ({
    ok: true,
    token: token(value, expiresAt),
});

describe("the token source", () => {
    it("mints on the first call", async () => {
        const { source, assertions } = harness([minted("t1", new Date(START.getTime() + HOUR_MS))]);
        const outcome = await source.current();
        expect(outcome).toEqual({
            ok: true,
            token: token("t1", new Date(START.getTime() + HOUR_MS)),
        });
        expect(assertions).toHaveLength(1);
    });

    it("returns a typed failure when the private key cannot sign", async () => {
        const source = createTokenSource({
            credentials: { ...credentials(), privateKeyPem: "not a private key" },
            clock: () => START,
            mint: () => {
                throw new Error("signing should fail before minting");
            },
        });

        expect(await source.current()).toEqual({
            ok: false,
            failure: { kind: "badCredentials" },
        });
    });

    it("contains a rejected mint as a transient failure", async () => {
        const source = createTokenSource({
            credentials: credentials(),
            clock: () => START,
            mint: () => Promise.reject(new Error("network escaped its boundary")),
        });

        expect(await source.current()).toEqual({
            ok: false,
            failure: { kind: "transient" },
        });
    });

    it("serves a live token from cache instead of minting again", async () => {
        const { source, assertions, advance } = harness([
            minted("t1", new Date(START.getTime() + HOUR_MS)),
        ]);
        await source.current();
        advance(HOUR_MS / 2);
        const second = await source.current();
        expect(second).toEqual({
            ok: true,
            token: token("t1", new Date(START.getTime() + HOUR_MS)),
        });
        expect(assertions).toHaveLength(1);
    });

    it("refreshes early, before the token actually expires", async () => {
        const expiry = new Date(START.getTime() + HOUR_MS);
        const { source, assertions, advance } = harness([
            minted("t1", expiry),
            minted("t2", new Date(expiry.getTime() + HOUR_MS)),
        ]);
        await source.current();
        // One second inside the skew window: still valid, already refreshed.
        advance(HOUR_MS - REFRESH_SKEW_SECONDS * 1000 + 1000);
        const refreshed = await source.current();
        expect(refreshed.ok && refreshed.token.value).toBe("t2");
        expect(assertions).toHaveLength(2);
    });

    it("does not refresh a second before the skew window opens", async () => {
        const { source, assertions, advance } = harness([
            minted("t1", new Date(START.getTime() + HOUR_MS)),
        ]);
        await source.current();
        advance(HOUR_MS - REFRESH_SKEW_SECONDS * 1000 - 1000);
        await source.current();
        expect(assertions).toHaveLength(1);
    });

    it("mints once for concurrent callers", async () => {
        const { source, assertions } = harness([minted("t1", new Date(START.getTime() + HOUR_MS))]);
        const [first, second, third] = await Promise.all([
            source.current(),
            source.current(),
            source.current(),
        ]);
        expect(assertions).toHaveLength(1);
        expect(first).toEqual(second);
        expect(second).toEqual(third);
    });

    it("pauses before retrying a failed initial mint", async () => {
        const { source, assertions, advance } = harness([
            { ok: false, failure: { kind: "transient" } },
            minted("t1", new Date(START.getTime() + HOUR_MS)),
        ]);
        const failed = await source.current();
        expect(failed).toEqual({ ok: false, failure: { kind: "transient" } });
        expect(await source.current()).toEqual(failed);
        expect(assertions).toHaveLength(1);
        advance(MINT_RETRY_COOLDOWN_SECONDS * 1000);
        const retried = await source.current();
        expect(retried.ok && retried.token.value).toBe("t1");
        expect(assertions).toHaveLength(2);
    });

    it("mints a fresh assertion for each mint", async () => {
        const { source, assertions, advance } = harness([
            minted("t1", new Date(START.getTime() + HOUR_MS)),
            minted("t2", new Date(START.getTime() + 2 * HOUR_MS)),
        ]);
        await source.current();
        advance(HOUR_MS);
        await source.current();
        expect(assertions[0]).not.toBe(assertions[1]);
    });

    it("serves the still-valid token when an early refresh fails", async () => {
        const { source, assertions, advance } = harness([
            minted("t1", new Date(START.getTime() + HOUR_MS)),
            { ok: false, failure: { kind: "transient" } },
        ]);
        await source.current();
        // Inside the skew window: refresh is due, the token is not expired.
        advance(HOUR_MS - REFRESH_SKEW_SECONDS * 1000 + 1000);
        const outcome = await source.current();
        expect(outcome.ok && outcome.token.value).toBe("t1");
        // The refresh WAS attempted — serving stale does not stop retrying.
        expect(assertions).toHaveLength(2);
    });

    it("pauses before retrying a failed early refresh", async () => {
        const expiry = new Date(START.getTime() + HOUR_MS);
        const { source, assertions, advance } = harness([
            minted("t1", expiry),
            { ok: false, failure: { kind: "transient" } },
            minted("t2", new Date(expiry.getTime() + HOUR_MS)),
        ]);
        await source.current();
        advance(HOUR_MS - REFRESH_SKEW_SECONDS * 1000 + 1000);
        expect((await source.current()).ok).toBe(true);

        advance(MINT_RETRY_COOLDOWN_SECONDS * 1000 - 1);
        expect((await source.current()).ok).toBe(true);
        expect(assertions).toHaveLength(2);

        advance(1);
        const refreshed = await source.current();
        expect(refreshed.ok && refreshed.token.value).toBe("t2");
        expect(assertions).toHaveLength(3);
    });

    it("does not retry a secondary limit while the held token works", async () => {
        const expiry = new Date(START.getTime() + HOUR_MS);
        const { source, assertions, advance } = harness([
            minted("t1", expiry),
            { ok: false, failure: { kind: "secondaryLimit" } },
            minted("t2", new Date(expiry.getTime() + HOUR_MS)),
        ]);
        await source.current();
        advance(HOUR_MS - REFRESH_SKEW_SECONDS * 1000 + 1000);
        expect((await source.current()).ok).toBe(true);

        advance(MINT_RETRY_COOLDOWN_SECONDS * 1000);
        expect((await source.current()).ok).toBe(true);
        expect(assertions).toHaveLength(2);

        advance(REFRESH_SKEW_SECONDS * 1000);
        const refreshed = await source.current();
        expect(refreshed.ok && refreshed.token.value).toBe("t2");
        expect(assertions).toHaveLength(3);
    });

    it("pauses repeated failures after the held token expires", async () => {
        const expiry = new Date(START.getTime() + HOUR_MS);
        const limited: TokenOutcome = { ok: false, failure: { kind: "secondaryLimit" } };
        const { source, assertions, advance } = harness([
            minted("t1", expiry),
            limited,
            limited,
            minted("t2", new Date(expiry.getTime() + HOUR_MS)),
        ]);
        await source.current();
        advance(HOUR_MS - REFRESH_SKEW_SECONDS * 1000 + 1000);
        expect((await source.current()).ok).toBe(true);

        advance(REFRESH_SKEW_SECONDS * 1000 - 1000);
        expect(await source.current()).toEqual(limited);
        expect(await source.current()).toEqual(limited);
        expect(assertions).toHaveLength(3);

        advance(MINT_RETRY_COOLDOWN_SECONDS * 1000);
        const refreshed = await source.current();
        expect(refreshed.ok && refreshed.token.value).toBe("t2");
        expect(assertions).toHaveLength(4);
    });

    it("propagates the failure once the held token is actually past expiry", async () => {
        const { source, advance } = harness([
            minted("t1", new Date(START.getTime() + HOUR_MS)),
            { ok: false, failure: { kind: "transient" } },
        ]);
        await source.current();
        advance(HOUR_MS + 1000);
        expect(await source.current()).toEqual({
            ok: false,
            failure: { kind: "transient" },
        });
    });

    it("does not fall back to a token that was invalidated", async () => {
        const { source } = harness([
            minted("t1", new Date(START.getTime() + HOUR_MS)),
            { ok: false, failure: { kind: "transient" } },
        ]);
        await source.current();
        source.invalidate(token("t1", new Date(START.getTime() + HOUR_MS)));
        // GitHub rejected t1; a failed replacement mint must not resurrect it.
        expect(await source.current()).toEqual({
            ok: false,
            failure: { kind: "transient" },
        });
    });

    it("mints again after the held token is invalidated", async () => {
        const { source, assertions } = harness([
            minted("t1", new Date(START.getTime() + HOUR_MS)),
            minted("t2", new Date(START.getTime() + 2 * HOUR_MS)),
        ]);
        const first = await source.current();
        expect(first.ok).toBe(true);
        source.invalidate(token("t1", new Date(START.getTime() + HOUR_MS)));
        const second = await source.current();
        expect(second.ok && second.token.value).toBe("t2");
        expect(assertions).toHaveLength(2);
    });

    it("ignores an invalidation naming a token it no longer holds", async () => {
        const { source, assertions } = harness([minted("t1", new Date(START.getTime() + HOUR_MS))]);
        await source.current();
        source.invalidate(token("someone-elses", new Date(START.getTime() + HOUR_MS)));
        await source.current();
        expect(assertions).toHaveLength(1);
    });

    it("ignores invalidation before any token is cached", async () => {
        const { source, assertions } = harness([minted("t1", new Date(START.getTime() + HOUR_MS))]);
        source.invalidate(token("not-cached", new Date(START.getTime() + HOUR_MS)));
        expect((await source.current()).ok).toBe(true);
        expect(assertions).toHaveLength(1);
    });
});

describe("reading a token's age", () => {
    it("is past expiry at the expiry instant, not a millisecond later", () => {
        const expiry = new Date(START.getTime() + HOUR_MS);
        expect(isPastExpiry(token("t1", expiry), new Date(expiry.getTime() - 1))).toBe(false);
        expect(isPastExpiry(token("t1", expiry), expiry)).toBe(true);
        expect(isPastExpiry(token("t1", expiry), new Date(expiry.getTime() + 1))).toBe(true);
    });
});

describe("the mint floor", () => {
    /**
     * The condition the floor exists for: a clock running an hour fast makes
     * every freshly minted token look already-stale, and without the floor
     * every call would mint.
     */
    function skewedHarness() {
        const h = harness([
            minted("t1", new Date(START.getTime() + HOUR_MS)),
            minted("t2", new Date(START.getTime() + HOUR_MS)),
        ]);
        h.advance(HOUR_MS + HOUR_MS / 2);
        return h;
    }

    it("serves a just-minted token that a fast clock reads as expired", async () => {
        const { source, assertions, advance } = skewedHarness();
        const first = await source.current();
        expect(first.ok && first.token.value).toBe("t1");
        advance(1000);
        const second = await source.current();
        expect(second.ok && second.token.value).toBe("t1");
        // Without the floor this would be 2, and 3, and 4 — one per call.
        expect(assertions).toHaveLength(1);
    });

    it("mints again once the floor has passed", async () => {
        const { source, assertions, advance } = skewedHarness();
        await source.current();
        advance(MINT_FLOOR_SECONDS * 1000);
        await source.current();
        expect(assertions).toHaveLength(2);
    });

    it("does not hold the floor open for a token GitHub rejected", async () => {
        const { source, assertions } = skewedHarness();
        const first = await source.current();
        expect(first.ok).toBe(true);
        source.invalidate(token("t1", new Date(START.getTime() + HOUR_MS)));
        // Invalidation clears the cache, so the floor has nothing to serve.
        const second = await source.current();
        expect(second.ok && second.token.value).toBe("t2");
        expect(assertions).toHaveLength(2);
    });

    it("leaves an unskewed clock's refresh timing untouched", async () => {
        // The floor must not keep a genuinely stale token alive: here the
        // token really is inside the skew window, and refresh still happens.
        const { source, assertions, advance } = harness([
            minted("t1", new Date(START.getTime() + HOUR_MS)),
            minted("t2", new Date(START.getTime() + 2 * HOUR_MS)),
        ]);
        await source.current();
        advance(HOUR_MS - REFRESH_SKEW_SECONDS * 1000 + 1000);
        const refreshed = await source.current();
        expect(refreshed.ok && refreshed.token.value).toBe("t2");
        expect(assertions).toHaveLength(2);
    });
});

describe("the refresh window", () => {
    it("opens exactly one skew before expiry", () => {
        const expiry = new Date(START.getTime() + HOUR_MS);
        const opens = new Date(expiry.getTime() - REFRESH_SKEW_SECONDS * 1000);
        expect(isDueForRefresh(token("t1", expiry), new Date(opens.getTime() - 1))).toBe(false);
        expect(isDueForRefresh(token("t1", expiry), opens)).toBe(true);
    });

    it("stays open past expiry, so an unusable token is never read as fresh", () => {
        const expiry = new Date(START.getTime() + HOUR_MS);
        expect(isDueForRefresh(token("t1", expiry), new Date(expiry.getTime() + 1))).toBe(true);
    });
});

describe("grants from a mint response", () => {
    it("reads GitHub's permissions object as core's grant vocabulary", () => {
        expect(grantsFromPermissions({ issues: "write", contents: "read" })).toEqual([
            "issues:write",
            "contents:read",
        ]);
    });

    it("drops a level core's vocabulary cannot express, rather than guessing", () => {
        expect(
            grantsFromPermissions({ organization_administration: "admin", issues: "read" }),
        ).toEqual(["issues:read"]);
    });

    it("answers an empty grant list for an installation with none", () => {
        expect(grantsFromPermissions({})).toEqual([]);
    });
});
