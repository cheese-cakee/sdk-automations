/**
 * The assertion is signed for GitHub's reading of it, not ours: a real
 * verifier accepts the signature, and both time bounds are asserted against
 * literals so a mutated constant fails rather than moving the expectation
 * with it.
 */

import { createVerify } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
    ASSERTION_BACKDATE_SECONDS,
    ASSERTION_LIFETIME_SECONDS,
    signAppAssertion,
} from "../src/jwt.js";
import { credentials, keyPair, TEST_NOW as NOW } from "./harness.js";

const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);

function claimsOf(assertion: string): Record<string, unknown> {
    const segment = assertion.split(".")[1];
    expect(segment).toBeDefined();
    return JSON.parse(Buffer.from(segment!, "base64url").toString("utf8")) as Record<
        string,
        unknown
    >;
}

describe("the app assertion", () => {
    it("carries a signature a real RS256 verifier accepts", () => {
        const assertion = signAppAssertion(credentials(), NOW);
        const [header, payload, signature] = assertion.split(".");
        expect(signature).toBeDefined();
        const verified = createVerify("RSA-SHA256")
            .update(`${header!}.${payload!}`)
            .verify(keyPair().publicKey, Buffer.from(signature!, "base64url"));
        expect(verified).toBe(true);
    });

    it("declares RS256 in the header", () => {
        const header = signAppAssertion(credentials(), NOW).split(".")[0];
        expect(header).toBeDefined();
        expect(JSON.parse(Buffer.from(header!, "base64url").toString("utf8"))).toEqual({
            alg: "RS256",
            typ: "JWT",
        });
    });

    it("names the app as issuer", () => {
        expect(claimsOf(signAppAssertion(credentials(), NOW))["iss"]).toBe("123456");
    });

    it("backdates iat by a minute, because the two clocks differ", () => {
        // The literal is the point: reading the constant here would let a
        // mutant change both the code and this expectation together.
        expect(claimsOf(signAppAssertion(credentials(), NOW))["iat"]).toBe(NOW_SECONDS - 60);
    });

    it("spans 540 seconds, inside GitHub's 600-second ceiling", () => {
        const claims = claimsOf(signAppAssertion(credentials(), NOW));
        expect((claims["exp"] as number) - (claims["iat"] as number)).toBe(540);
        expect((claims["exp"] as number) - (claims["iat"] as number)).toBeLessThanOrEqual(600);
    });

    it("moves with the clock it is given", () => {
        const later = new Date(NOW.getTime() + 3_600_000);
        expect(claimsOf(signAppAssertion(credentials(), later))["iat"]).toBe(
            NOW_SECONDS + 3600 - 60,
        );
    });

    it("keeps the declared lifetime inside GitHub's published bound", () => {
        // GitHub's rule is on the span from `iat`, which is the lifetime
        // alone; the backdate only moves both ends earlier.
        expect(ASSERTION_LIFETIME_SECONDS).toBeLessThanOrEqual(600);
        expect(ASSERTION_BACKDATE_SECONDS).toBeGreaterThan(0);
    });
});
