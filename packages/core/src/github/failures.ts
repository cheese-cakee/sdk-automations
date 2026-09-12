/**
 * A failed GitHub call, from response to next action.
 *
 * `BODY_PATTERNS` holds dated snapshots of GitHub's prose, not contract. An
 * unmatched 403 becomes `forbiddenUnrecognized` rather than a confident
 * misdiagnosis, so green tests here mean only that the fixtures still agree
 * with themselves (`FINDING(failures-prose-snapshot)`, D40).
 */

import { MAX_AUTOMATIC_RATE_LIMIT_WAIT_SECONDS, parseSecondsHeader } from "./rate-limits.js";

// ─── The vocabulary: what arrived, what it turned out to be ─────────

/**
 * The inputs classification needs. `tokenPastExpiry` tells an expired token
 * from a wrong key: both return `"Bad credentials"` (`…T21-52-06-572Z#1`).
 */
export interface FailureObservation {
    readonly status: number;
    readonly body: string;
    readonly headers: Readonly<Record<string, string | undefined>>;
    readonly tokenPastExpiry?: boolean;
}

/** What a failed response turned out to be. */
export type FailureClass =
    /** 401; token past its 1 h TTL (6.1). */
    | { readonly kind: "tokenExpired" }
    /** 401 without the expiry marker — wrong or revoked credentials. */
    | { readonly kind: "badCredentials" }
    /** 403 naming the wanted grant — `x-accepted-github-permissions` (6.1). Private repos only; public reads succeed without the grant. */
    | { readonly kind: "permissionMissing"; readonly acceptedPermissions: string }
    /** 403, body names suspension, and the permissions header is absent (6.1). */
    | { readonly kind: "installationSuspended" }
    /** 403/429 secondary limit. Write-path evidence only (6.4, FINDING(secondary-limit-no-wait-signal), REPROBE(secondary-limit-read-path)). */
    | {
          readonly kind: "secondaryLimit";
          readonly retryAfterSeconds?: number;
      }
    /** Primary quota exhausted: `x-ratelimit-remaining: 0`. */
    | { readonly kind: "primaryExhausted"; readonly resetAt: string | undefined }
    /** A rate-limit response carried a malformed or unsupported wait signal. */
    | {
          readonly kind: "rateLimitResponseUnusable";
          readonly headerName: "retry-after";
          readonly headerValue: string;
          readonly reason: "invalid" | "aboveAutomaticLimit";
      }
    /** A 403 matching NO observed shape — carries the body verbatim, so a reworded message surfaces rather than being misdiagnosed (D40). */
    | { readonly kind: "forbiddenUnrecognized"; readonly bodySnippet: string }
    /** 404: not found OR App not installed there — GitHub hides existence (6.6 probe), the two are indistinguishable. */
    | { readonly kind: "notFoundOrNotInstalled" }
    /** 422 with structured `errors[]` — maintainer-showable verbatim (6.4). */
    | { readonly kind: "validationError" }
    /** A 3xx the client refused to follow; 301/308 are permanent, so the remedy is `location`, never a retry. */
    | {
          readonly kind: "redirected";
          readonly status: number;
          readonly location?: string;
          readonly permanent: boolean;
      }
    /** An otherwise-unclassified 4xx. Repeating the same request cannot repair it. */
    | { readonly kind: "clientError"; readonly status: number }
    /** A transport failure, request timeout, 408, or 5xx worth a bounded retry. */
    | { readonly kind: "transient" };

// ─── The perishable surface ──────────────────────────────────────────

/**
 * Every place this module reads GitHub's prose — the whole of D40's re-probe.
 * `observed` is each pattern's sample; `failures.test.ts` asserts they match.
 */
export const BODY_PATTERNS = {
    secondaryRateLimit: {
        pattern: /secondary rate limit/i,
        observed:
            "You have exceeded a secondary rate limit. Please wait a few minutes before you try again.",
        probedAt: "2026-07-23",
        experiment: "6.4",
    },
    installationSuspended: {
        pattern: /installation is currently suspended/i,
        observed: "This installation is currently suspended. Please contact an organization owner.",
        probedAt: "2026-07-23",
        experiment: "6.1",
    },
} as const;

// ─── Classification ──────────────────────────────────────────────────

/** Read one failed response into exactly one class. */
export function classifyFailure(observation: FailureObservation): FailureClass {
    const body = observation.body;
    // 304 is a conditional-read result, not a redirect; it falls through to transient.
    if (observation.status >= 300 && observation.status < 400 && observation.status !== 304) {
        const location = observation.headers.location;
        return {
            kind: "redirected",
            status: observation.status,
            permanent: observation.status === 301 || observation.status === 308,
            ...(location === undefined ? {} : { location }),
        };
    }
    if (observation.status === 401) {
        return observation.tokenPastExpiry === true
            ? { kind: "tokenExpired" }
            : { kind: "badCredentials" };
    }
    if (observation.status === 403 || observation.status === 429) {
        // Both exhaustions arrive as 403 or 429, so the documented primary
        // signal takes precedence over status alone.
        if (observation.headers["x-ratelimit-remaining"] === "0") {
            return { kind: "primaryExhausted", resetAt: observation.headers["x-ratelimit-reset"] };
        }
        if (BODY_PATTERNS.secondaryRateLimit.pattern.test(body) || observation.status === 429) {
            const retryAfter = parseSecondsHeader(observation.headers["retry-after"]);
            switch (retryAfter.kind) {
                case "missing":
                    return { kind: "secondaryLimit" };
                case "invalid":
                    return {
                        kind: "rateLimitResponseUnusable",
                        headerName: "retry-after",
                        headerValue: retryAfter.rawValue,
                        reason: "invalid",
                    };
                case "valid":
                    return retryAfter.seconds > MAX_AUTOMATIC_RATE_LIMIT_WAIT_SECONDS
                        ? {
                              kind: "rateLimitResponseUnusable",
                              headerName: "retry-after",
                              headerValue: String(retryAfter.seconds),
                              reason: "aboveAutomaticLimit",
                          }
                        : {
                              kind: "secondaryLimit",
                              retryAfterSeconds: retryAfter.seconds,
                          };
            }
        }
        const accepted = observation.headers["x-accepted-github-permissions"];
        if (accepted !== undefined) {
            return { kind: "permissionMissing", acceptedPermissions: accepted };
        }
        if (BODY_PATTERNS.installationSuspended.pattern.test(body)) {
            return { kind: "installationSuspended" };
        }
        return { kind: "forbiddenUnrecognized", bodySnippet: body.slice(0, 200) };
    }
    if (observation.status === 404) return { kind: "notFoundOrNotInstalled" };
    if (observation.status === 422) return { kind: "validationError" };
    if (observation.status >= 400 && observation.status < 500 && observation.status !== 408) {
        return { kind: "clientError", status: observation.status };
    }
    return { kind: "transient" };
}

// ─── What to do next ─────────────────────────────────────────────────

/** What the caller should do next — the retry policy's pure half. */
export type RetryAdvice =
    | { readonly action: "retryAfterMs"; readonly ms: number }
    | { readonly action: "refreshTokenAndRetry" }
    | { readonly action: "doNotRetry"; readonly surfaceTo: "maintainer" | "operator" };

/** A limit that survives this many full waits is a pacing problem for an operator (6.4). */
export const MAX_RATE_LIMIT_ATTEMPTS = 3;

/** Token minting is an authentication concern, not a pacing concern. */
export const MAX_TOKEN_REFRESH_ATTEMPTS = 3;

/**
 * The caller supplies the attempt count because a counter that resets with
 * the process is not a bound (D42, D24).
 */
/** Transient backoff, doubling-ish; the list's length IS the attempt bound. */
const BACKOFF_MS = [500, 2_000, 8_000] as const;

export function retryAdvice(
    failure: FailureClass,
    attempt: number,
    nowEpochSeconds: number,
): RetryAdvice {
    switch (failure.kind) {
        case "tokenExpired":
            return attempt >= MAX_TOKEN_REFRESH_ATTEMPTS
                ? { action: "doNotRetry", surfaceTo: "operator" }
                : { action: "refreshTokenAndRetry" };
        case "secondaryLimit":
            return attempt >= MAX_RATE_LIMIT_ATTEMPTS
                ? { action: "doNotRetry", surfaceTo: "operator" }
                : {
                      action: "retryAfterMs",
                      ms: Math.max(60_000, (failure.retryAfterSeconds ?? 0) * 1000),
                  };
        case "primaryExhausted": {
            if (attempt >= MAX_RATE_LIMIT_ATTEMPTS) {
                return { action: "doNotRetry", surfaceTo: "operator" };
            }
            const reset = parseSecondsHeader(failure.resetAt);
            if (reset.kind !== "valid" || !Number.isFinite(nowEpochSeconds)) {
                return { action: "doNotRetry", surfaceTo: "operator" };
            }
            const waitSeconds = Math.max(0, reset.seconds - nowEpochSeconds);
            return waitSeconds > MAX_AUTOMATIC_RATE_LIMIT_WAIT_SECONDS
                ? { action: "doNotRetry", surfaceTo: "operator" }
                : { action: "retryAfterMs", ms: waitSeconds * 1000 };
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
        case "rateLimitResponseUnusable":
        case "notFoundOrNotInstalled":
        case "redirected":
        case "clientError":
            return { action: "doNotRetry", surfaceTo: "operator" };
    }
}
