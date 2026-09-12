/**
 * The shapes and spellings every GitHub exchange in this package speaks.
 *
 * Nothing here judges a request or sends one. This file owns the vocabulary
 * its neighbours share: the constants a call is built from, the request and
 * outcome types, the failures the adapter constructs itself, and the handful
 * of spellings that must be identical everywhere a call is made — a
 * repository's API path, a lower-cased header record, the page a `link` names.
 *
 * Core owns the vocabulary for GitHub's own responses; the two results core
 * cannot have are added here, on `GitHubHttpFailureClass`. Whether a request
 * may be sent is `admission.ts`. How an admitted one travels and comes back
 * classified is `http.ts`. Which token it carries is `token.ts`.
 *
 * In order below: the shared constants, the request vocabulary, the
 * spellings, the failures.
 */

import type { FailureClass } from "@hiero-hackers/automation-core";
import type { TokenSource } from "./token.js";

// ─── The shared constants ────────────────────────────────────────────

/** The REST version this client has been checked against. */
export const GITHUB_API_VERSION = "2026-03-10";

/** Installation credentials never leave GitHub's public API origin. */
export const GITHUB_API_ORIGIN = "https://api.github.com";

/** The only POST target: GitHub's read-only GraphQL query endpoint. */
export const GITHUB_GRAPHQL_URL = `${GITHUB_API_ORIGIN}/graphql`;

/** A request gets this long per attempt unless the composition root chooses less. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

/** Sent on every request this package makes, the mint's POST included. */
export const USER_AGENT = "hiero-hackers-sdk-automations";

// ─── The request vocabulary ──────────────────────────────────────────

/** The operation-specific part of a GitHub request. */
interface GitHubGetRequest {
    readonly url: string;
    readonly method: "GET";
    readonly headers?: Readonly<Record<string, string>>;
}

export interface GitHubGraphqlRequest {
    readonly url: string;
    readonly method: "POST";
    readonly body: string;
    readonly headers?: Readonly<Record<string, string>>;
}

/**
 * Whether sending this write twice could change the world twice.
 *
 * The CALLER declares it. Nothing in a method or a URL says it: a POST that
 * adds a label already present is a no-op, and a POST that creates a comment
 * is not, and the two are the same verb at neighbouring paths.
 */
export type WriteIdempotency = "idempotent" | "nonIdempotent";

/**
 * A REST write at one of the endpoints `admission.ts` admits.
 *
 * `idempotency` is what marks a request as a write at all — the other two arms
 * do not declare it — so a DELETE or PATCH that forgets it is refused as a
 * disallowed method rather than sent unexamined.
 */
export interface GitHubWriteRequest {
    readonly url: string;
    readonly method: "POST" | "DELETE" | "PATCH";
    readonly body?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly idempotency: WriteIdempotency;
}

/** REST reads, the one admitted GraphQL POST, or an admitted REST write. */
export type GitHubRequest = GitHubGetRequest | GitHubGraphqlRequest | GitHubWriteRequest;

/** A usable response, whether GitHub sent the body or the cache held it. */
export interface GitHubSuccess {
    readonly ok: true;
    readonly status: number;
    readonly body: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly fromCache: boolean;
}

/** A classified failure; response fields are absent when nothing was sent. */
export interface GitHubFailure {
    readonly ok: false;
    readonly failure: GitHubHttpFailureClass;
    readonly status?: number;
    readonly body?: string;
    readonly headers?: Readonly<Record<string, string>>;
}

/** Why the adapter refused or could not construct a request locally. */
export type NotSentReason =
    | "disallowedMethod"
    | "disallowedOrigin"
    | "malformedUrl"
    | "invalidHeaders"
    | "invalidBody"
    | "brokenSeam";

/**
 * The injected seam a `brokenSeam` refusal names as the one that failed.
 *
 * A seam failure is rare and hard to reproduce, so the one report an
 * operator gets must say which piece of wiring broke.
 */
export type BrokenSeam =
    "tokenSource" | "clock" | "timeoutSignal" | "tokenValue" | "invalidate" | "response" | "sleep";

/**
 * Core owns the response classes; the adapter adds the two it cannot have.
 *
 * `notSent` is a request refused before it left the process.
 * `responseTooLarge` is the opposite end: a response that arrived and was
 * abandoned at the client's `MAX_RESPONSE_BODY_BYTES`. Neither is ever
 * retried — the refusal is deterministic, and a re-read returns the same
 * bytes.
 */
export type GitHubHttpFailureClass =
    | FailureClass
    | { readonly kind: "responseTooLarge"; readonly limitBytes: number }
    | { readonly kind: "notSent"; readonly reason: Exclude<NotSentReason, "brokenSeam"> }
    | { readonly kind: "notSent"; readonly reason: "brokenSeam"; readonly seam: BrokenSeam };

/** What one call to `request()` resolves to — it never throws. */
export type GitHubOutcome = GitHubSuccess | GitHubFailure;

/** The `x-ratelimit-*` headers of the most recent actual response. */
export interface RateLimitSnapshot {
    readonly url: string;
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
}

/** The shape of `fetch`, named so tests can script it. */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * Seams the composition root supplies; only the token source is required.
 *
 * `sleep` is injected for the same reason `clock` is: a suite that waited the
 * advised delays would take minutes and prove nothing the recorded pauses do
 * not prove instantly.
 */
export interface GitHubHttpClientOptions {
    readonly tokenSource: TokenSource;
    readonly fetch?: FetchLike;
    readonly clock?: () => Date;
    readonly sleep?: (milliseconds: number) => Promise<void>;
    readonly timeoutMs?: number;
    /** Injection keeps timeout tests deterministic; production uses `AbortSignal.timeout`. */
    readonly timeoutSignal?: (milliseconds: number) => AbortSignal;
}

/** What every operation calls; see the file header for what it owns. */
export interface GitHubHttpClient {
    request(request: GitHubRequest): Promise<GitHubOutcome>;
    /** The last actual response, including a response that was retried. */
    latestRateLimit(): RateLimitSnapshot | null;
}

// ─── The spellings ───────────────────────────────────────────────────

/** The one spelling of a repository's API path — owner and repo encoded
 * once, identically, for every operation that names one. */
export function repoPath(repository: { readonly owner: string; readonly repo: string }): string {
    return (
        `${GITHUB_API_ORIGIN}/repos/${encodeURIComponent(repository.owner)}` +
        `/${encodeURIComponent(repository.repo)}`
    );
}

/** Lower-cased header record, the shape core's classifier reads. */
export function headersToRecord(headers: Headers): Record<string, string> {
    const record: Record<string, string> = {};
    headers.forEach((value, name) => {
        record[name.toLowerCase()] = value;
    });
    return record;
}

/**
 * The page `rel="last"` names in a `link` header, or `null` when absent.
 * That does NOT imply a complete response. Pagination is this client's vocabulary —
 * the cache retains `link` on stored representations for exactly this read.
 */
export function lastPageFromLink(link: string | undefined): number | null {
    // Stryker disable next-line ConditionalExpression: exec stringifies undefined and misses; the guard is for readers.
    if (link === undefined) return null;
    const match = /[?&]page=(\d+)[^>]*>;\s*rel="last"/.exec(link);
    return match === null ? null : Number(match[1]);
}

/** Does this request declare itself a write? Only the write arm may. */
export function isWrite(request: GitHubRequest): request is GitHubWriteRequest {
    return "idempotency" in request;
}

/** The body a request carries, or `undefined` when it carries none. */
export function bodyOf(request: GitHubRequest): string | undefined {
    if (!("body" in request)) return undefined;
    return typeof request.body === "string" ? request.body : undefined;
}

// ─── The failures ────────────────────────────────────────────────────

/** Genuine transport weather — the one locally-made class worth a retry. */
export function transportFailure(): GitHubFailure {
    return { ok: false, failure: { kind: "transient" } };
}

/** The request never left the process; retrying cannot help. */
export function notSentFailure(reason: Exclude<NotSentReason, "brokenSeam">): GitHubFailure {
    return { ok: false, failure: { kind: "notSent", reason } };
}

/** A wiring defect in the named injected seam — never weather, never retried. */
export function brokenSeamFailure(seam: BrokenSeam): GitHubFailure {
    return { ok: false, failure: { kind: "notSent", reason: "brokenSeam", seam } };
}

/**
 * One line naming a failure, with the detail the adapter's own classes carry.
 *
 * Every seam this package fills answers in core's vocabulary, and none of
 * those vocabularies has room for a `brokenSeam` name or a byte limit. The
 * kind alone tells an operator a request failed; this tells them what to fix.
 */
export function describeFailure(failure: GitHubHttpFailureClass): string {
    if (failure.kind === "responseTooLarge") {
        return `responseTooLarge (over ${String(failure.limitBytes)} bytes)`;
    }
    if (failure.kind !== "notSent") return failure.kind;
    return failure.reason === "brokenSeam"
        ? `notSent (broken seam: ${failure.seam})`
        : `notSent (${failure.reason})`;
}
