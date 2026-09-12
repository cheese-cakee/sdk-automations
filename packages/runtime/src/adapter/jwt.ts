/**
 * What proves we are the App: the short-lived assertion every call starts from.
 *
 * `token.ts` exchanges one of these for an installation token. Nothing here
 * reads a clock or the network — `now` arrives from the caller, so the whole
 * file is a pure function of its inputs.
 *
 * Both bounds below are GitHub's, not preferences: it rejects an assertion
 * whose `iat` sits in its own future, and one whose span exceeds ten minutes.
 */

import { createSign } from "node:crypto";

/** The three untracked environment values a GitHub App authenticates with. */
export interface AppCredentials {
    readonly appId: string;
    readonly privateKeyPem: string;
    readonly installationId: string;
}

/** Backdates `iat`, because our clock and GitHub's are not the same clock. */
export const ASSERTION_BACKDATE_SECONDS = 60;

/** Span from `iat`. GitHub's ceiling is 600; the margin absorbs drift. */
export const ASSERTION_LIFETIME_SECONDS = 540;

const encode = (claims: object): string =>
    Buffer.from(JSON.stringify(claims)).toString("base64url");

/** Sign one assertion for `now`, valid for the lifetime above. */
export function signAppAssertion(credentials: AppCredentials, now: Date): string {
    const issuedAt = Math.floor(now.getTime() / 1000) - ASSERTION_BACKDATE_SECONDS;
    const signingInput = [
        encode({ alg: "RS256", typ: "JWT" }),
        encode({
            iat: issuedAt,
            exp: issuedAt + ASSERTION_LIFETIME_SECONDS,
            iss: credentials.appId,
        }),
    ].join(".");
    const signature = createSign("RSA-SHA256")
        .update(signingInput)
        .sign(credentials.privateKeyPem)
        .toString("base64url");
    return `${signingInput}.${signature}`;
}
