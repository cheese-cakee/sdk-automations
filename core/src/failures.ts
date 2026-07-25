/**
 * The failure catalogue as executable classification — the
 * `design/operations/endpoint-permission-matrix.md` failure table
 * turned into one pure function, because the stage-three evidence
 * showed the classes are distinguishable only by reading bodies and
 * headers together (a status code alone conflates four different
 * 403s). Every rule cites the run that observed it.
 *
 * The adapter owns retry policy explicitly (Octokit's default plugins
 * are disabled — 6.4); `retryAdvice` below is that policy's pure core.
 *
 * FINDING(failures-prose-snapshot), D40: body regexes are snapshots of
 * observed prose, not contracts. Rot degrades into
 * `forbiddenUnrecognized`; a periodic sandbox re-probe re-validates
 * the fixtures.
 */

/** The inputs classification needs — transport-agnostic. */
export interface FailureObservation {
    readonly status: number;
    readonly body: string;
    readonly headers: Readonly<Record<string, string | undefined>>;
    /**
     * Whether the caller's token was already past its minted
     * `expires_at` when the request was sent. REQUIRED for correct 401
     * classification: an expired installation token returns the exact
     * same body as a wrong key (`"Bad credentials"` — observed
     * 2026-07-23, citation `…T21-52-06-572Z#1`), so expiry is
     * distinguishable ONLY by this local fact, never by the response.
     */
    readonly tokenPastExpiry?: boolean;
}

export type FailureClass =
    /** 401; token past its 1 h TTL (6.1). */
    | { readonly kind: "tokenExpired" }
    /** 401 without the expiry marker — wrong or revoked credentials. */
    | { readonly kind: "badCredentials" }
    /** 403 naming the wanted grant — `x-accepted-github-permissions` (6.1). Private repos only; public reads succeed without the grant. */
    | { readonly kind: "permissionMissing"; readonly acceptedPermissions: string }
    /** 403, body names suspension, and the permissions header is absent (6.1). */
    | { readonly kind: "installationSuspended" }
    /** 403 secondary limit: body prose only — no `retry-after`, primary quota untouched (6.4, FINDING(secondary-limit-no-wait-signal)). */
    | { readonly kind: "secondaryLimit" }
    /** Primary quota exhausted: `x-ratelimit-remaining: 0`. */
    | { readonly kind: "primaryExhausted"; readonly resetAt: string | undefined }
    /**
     * A 403 matching NO observed shape — explicit ignorance carrying
     * the evidence, so a reworded GitHub body surfaces instead of
     * being misdiagnosed (D40).
     */
    | { readonly kind: "forbiddenUnrecognized"; readonly bodySnippet: string }
    /** 404: not found OR App not installed there — GitHub hides existence (6.6 probe), the two are indistinguishable. */
    | { readonly kind: "notFoundOrNotInstalled" }
    /** 422 with structured `errors[]` — maintainer-showable verbatim (6.4). */
    | { readonly kind: "validationError" }
    /** 5xx and everything else worth one bounded retry. */
    | { readonly kind: "transient" };

export function classifyFailure(o: FailureObservation): FailureClass {
    const body = o.body;
    if (o.status === 401) {
        // The 6.1 probe falsified body-based detection: an expired
        // token and a wrong key both return "Bad credentials". Local
        // token age is the only distinguisher.
        return o.tokenPastExpiry === true
            ? { kind: "tokenExpired" }
            : { kind: "badCredentials" };
    }
    if (o.status === 403) {
        if (/secondary rate limit/i.test(body)) return { kind: "secondaryLimit" };
        if (o.headers["x-ratelimit-remaining"] === "0") {
            return { kind: "primaryExhausted", resetAt: o.headers["x-ratelimit-reset"] };
        }
        const accepted = o.headers["x-accepted-github-permissions"];
        if (accepted !== undefined) {
            return { kind: "permissionMissing", acceptedPermissions: accepted };
        }
        if (/installation is currently suspended/i.test(body)) {
            return { kind: "installationSuspended" };
        }
        // No observed shape matched — say so, carrying the evidence.
        return { kind: "forbiddenUnrecognized", bodySnippet: body.slice(0, 200) };
    }
    if (o.status === 404) return { kind: "notFoundOrNotInstalled" };
    if (o.status === 422) return { kind: "validationError" };
    return { kind: "transient" };
}

/** What the caller should do next — the retry policy's pure half. */
export type RetryAdvice =
    | { readonly action: "retryAfterMs"; readonly ms: number }
    | { readonly action: "refreshTokenAndRetry" }
    | { readonly action: "doNotRetry"; readonly surfaceTo: "maintainer" | "operator" };

/**
 * A limit that survives this many full waits is a pacing-design
 * problem for an operator, not a wait problem (6.4).
 */
export const MAX_RATE_LIMIT_ATTEMPTS = 3;

/**
 * Bounded, evidence-derived retry policy:
 * - secondary limit: GitHub's documented one-minute floor — no header
 *   exists to trust (6.4) — for at most MAX_RATE_LIMIT_ATTEMPTS;
 * - primary exhaustion: wait for the reset epoch, same bound;
 * - transient: bounded exponential backoff, attempt-indexed;
 * - everything else is a diagnosis, not a retry problem (D24).
 * Deterministic by design; the caller adds jitter if needed.
 */
export function retryAdvice(
    failure: FailureClass,
    attempt: number,
    nowEpochSeconds: number,
): RetryAdvice {
    const BACKOFF_MS = [500, 2_000, 8_000] as const;
    switch (failure.kind) {
        case "tokenExpired":
            return { action: "refreshTokenAndRetry" };
        case "secondaryLimit":
            return attempt >= MAX_RATE_LIMIT_ATTEMPTS
                ? { action: "doNotRetry", surfaceTo: "operator" }
                : { action: "retryAfterMs", ms: 60_000 };
        case "primaryExhausted": {
            if (attempt >= MAX_RATE_LIMIT_ATTEMPTS) {
                return { action: "doNotRetry", surfaceTo: "operator" };
            }
            const reset = Number(failure.resetAt ?? Number.NaN);
            const waitMs = Number.isFinite(reset)
                ? Math.max(0, reset - nowEpochSeconds) * 1000
                : 60_000;
            return { action: "retryAfterMs", ms: waitMs };
        }
        case "transient": {
            const ms = BACKOFF_MS[attempt];
            return ms === undefined
                ? { action: "doNotRetry", surfaceTo: "operator" }
                : { action: "retryAfterMs", ms };
        }
        case "validationError":
            return { action: "doNotRetry", surfaceTo: "maintainer" };
        case "badCredentials":
        case "permissionMissing":
        case "installationSuspended":
        case "forbiddenUnrecognized":
        case "notFoundOrNotInstalled":
            return { action: "doNotRetry", surfaceTo: "operator" };
    }
}
