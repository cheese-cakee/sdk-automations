/**
 * The one authenticated GitHub call path used by every adapter operation.
 *
 * This file deliberately owns the mechanics that would otherwise drift
 * between operations: request headers, timeouts, the bounded ETag cache, the
 * bounded body read, rate-limit state and the pacing it feeds, refusal of
 * redirects, and how long a failure is waited on before it is handed back.
 * Waiting is this file's job because nothing below it may hold a claimed
 * delivery, and nothing above it can see a `retry-after` (D20).
 *
 * Core owns the vocabulary for GitHub responses and the retry advice for each
 * class. The shapes every operation speaks, and the two results core cannot
 * have, are `contract.ts`. Whether a request may be sent at all is
 * `admission.ts` — the pinned origin, the one admitted GraphQL query, the four
 * write endpoints, and the grants a request needs — and this file is its only
 * caller. Which token to send is `token.ts`.
 *
 * Writes travel this same path behind that gate. What each answer MEANS is
 * `writes.ts`; this file only decides how often an admitted write may be sent
 * again, and what its landing makes untrustworthy in the cache.
 *
 * In order below: the chosen bounds, the retry policy, the representation
 * cache, the client.
 */

import {
    classifyFailure,
    MAX_RATE_LIMIT_ATTEMPTS,
    parseSecondsHeader,
    retryAdvice,
    type FailureClass,
} from "@hiero-hackers/automation-core";
import { admit, missingGrants } from "./admission.js";
import {
    bodyOf,
    brokenSeamFailure,
    DEFAULT_REQUEST_TIMEOUT_MS,
    GITHUB_API_VERSION,
    headersToRecord,
    isWrite,
    notSentFailure,
    transportFailure,
    USER_AGENT,
    type GitHubFailure,
    type GitHubHttpClient,
    type GitHubHttpClientOptions,
    type GitHubHttpFailureClass,
    type GitHubOutcome,
    type GitHubRequest,
    type RateLimitSnapshot,
} from "./contract.js";
import {
    isPastExpiry,
    isWellFormedTokenOutcome,
    type InstallationToken,
    type TokenOutcome,
} from "./token.js";

// ─── The chosen bounds ───────────────────────────────────────────────

/** Full representations retained for conditional reads, least-recently-used. */
export const DEFAULT_ETAG_CACHE_ENTRIES = 1_000;

/** Retained bodies across all entries, in UTF-16 code units — close enough for a bound. */
export const DEFAULT_ETAG_CACHE_BYTES = 20 * 1024 * 1024;

/** A body larger than this is not worth retaining for a conditional re-read. */
export const DEFAULT_ETAG_CACHE_ENTRY_BYTES = 512 * 1024;

/**
 * The largest response body this client will read.
 *
 * Eight times the per-entry cache bound above: a body too large to retain is
 * still read whole and classified, and anything past this is abandoned
 * mid-stream rather than buffered. The largest response any operation here
 * asks for is a hundred-entry timeline page.
 */
export const MAX_RESPONSE_BODY_BYTES = 8 * DEFAULT_ETAG_CACHE_ENTRY_BYTES;

const DEFAULT_ACCEPT = "application/vnd.github+json";

/** Attempts per request on a rejected token: the first, then one fresh mint. */
const TOKEN_REFRESH_ATTEMPTS = 2;

/**
 * Attempts per request on weather, where core's backoff list would allow four.
 *
 * The shell already re-runs the whole delivery up to five times with its own
 * doubling backoff, so an in-request retry only has to clear a blip a second
 * send clears. Further attempts duplicate that machinery while holding a claim.
 */
const TRANSIENT_ATTEMPTS = 2;

/**
 * Everything one `request()` may spend asleep, across all of its retries.
 *
 * The caller sits inside a claimed delivery, and a claim older than the
 * shell's `STALE_CLAIM_MINUTES` (15) is presumed dead and taken over. Thirty
 * seconds is three percent of that window: long enough for the one wait worth
 * taking in process — a primary budget whose reset is already seconds away —
 * and far too short for a secondary limit's sixty-second floor or a distant
 * reset. Those return at once, into the shell's counted-attempt retry and
 * dead-letter machinery, rather than camping on the claim.
 *
 * Per request rather than per delivery, because a wait long enough to matter
 * ends the delivery's reading anyway: every caller in this package returns on
 * its first failed request.
 */
export const MAX_RETRY_WAIT_MS = 30_000;

/**
 * How much of a backoff this package CHOSE is spent spreading it out.
 *
 * Jitter is added only where the advice carries no wait signal of its own. An
 * instant GitHub dictated is the same for every worker and waiting past it is
 * already required; a chosen constant fires every worker that failed together
 * back in lockstep. The spread comes from the clock rather than a random
 * source, so a wait stays reproducible in a report and is still decorrelated:
 * two workers that fail on different milliseconds wait different amounts.
 */
const BACKOFF_JITTER_FRACTION = 0.25;

/**
 * Primary-budget requests held back rather than spent.
 *
 * The shared rate budget is a protected asset, and one repository must not be
 * able to make every installation unavailable (threat model §2). One percent
 * of GitHub's hourly five thousand. Under it this client stops as if already
 * exhausted, so work ends countably in the shell's retry machinery instead of
 * at the hard wall, halfway through a delivery.
 */
export const PRIMARY_BUDGET_RESERVE = 50;

/**
 * The smallest gap between two comment creations this client will leave.
 *
 * Experiment 6.4 tripped an UNSIGNALLED secondary limit at roughly eighty
 * writes a minute (~71 at concurrency 20, no `retry-after`), and core's advice
 * for a limit with no wait signal is a sixty-second floor — so tripping it
 * costs a minute and returns nothing to wait on. Two seconds is thirty a
 * minute, under forty percent of the observed threshold, and a delivery that
 * writes a handful of comments never notices it. The number is a floor to stay
 * far below, not a target to approach.
 *
 * Two honest limits. It is per client instance, so a second process doubles
 * the real rate. And it spaces CREATION only: 6.4 measured content creation,
 * and a label call is not content.
 */
export const CONTENT_CREATION_SPACING_MS = 2_000;

// ─── The retry policy ────────────────────────────────────────────────

/** The production pause between attempts, and the only real timer here. */
export const wait = (milliseconds: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, milliseconds));

/** What one request does about a failure it has just classified. */
type NextStep =
    | { readonly step: "return" }
    | { readonly step: "refreshToken" }
    | { readonly step: "wait"; readonly ms: number };

/** The class core can advise on; the adapter's own two are never retried. */
function responseClassOf(failure: GitHubHttpFailureClass): FailureClass | null {
    return failure.kind === "notSent" || failure.kind === "responseTooLarge" ? null : failure;
}

/**
 * Sends one request may make on this class, counting the first.
 *
 * The rate classes get core's bound, which was measured: a limit surviving
 * three full waits is a pacing problem for an operator, not a wait problem.
 * The other two are this file's, and both are tighter than core's — see their
 * constants for why a process holding a claim spends less than a caller with
 * no deadline. A class core refuses to retry never reaches its cap.
 */
function attemptCap(kind: FailureClass["kind"]): number {
    if (kind === "tokenExpired") return TOKEN_REFRESH_ATTEMPTS;
    if (kind === "transient") return TRANSIENT_ATTEMPTS;
    return MAX_RATE_LIMIT_ATTEMPTS;
}

/**
 * May this request be sent again inside one `request()` call?
 *
 * Reads and idempotent writes retry under the caps above. A NON-IDEMPOTENT
 * write gets zero in-client retries of any class, and the exception list is
 * empty on purpose.
 *
 * The tempting version keeps the classes that prove nothing happened — a 401,
 * a rate limit — and drops only the ambiguous ones. It is wrong in the way
 * that matters. The dangerous class is `transient`, which covers a timeout and
 * a dropped socket, and those are exactly the failures where GitHub may have
 * applied the change and lost the answer on the way back. Experiment 6.5
 * turned that into a duplicated comment on the first attempt at a blind retry.
 * A per-class exemption also has to stay right forever: the day a new class
 * lands in `classifyFailure`, a list of safe ones silently admits it.
 *
 * So the rule is one rule with no arms. A failure returns immediately, with
 * its class intact, to the journal and read-back layer above — which owns
 * recovery because it is the only layer that can look at GitHub and see
 * whether the effect landed (D46).
 */
function mayRetryInClient(request: GitHubRequest): boolean {
    return !isWrite(request) || request.idempotency === "idempotent";
}

/** The spread added to a chosen backoff; see `BACKOFF_JITTER_FRACTION`. */
function jitterMs(kind: FailureClass["kind"], advisedMs: number, now: Date): number {
    if (kind !== "transient") return 0;
    const span = Math.floor(advisedMs * BACKOFF_JITTER_FRACTION);
    return span < 1 ? 0 : now.getTime() % span;
}

/**
 * What to do about `failure` after `attempt` earlier failures of this request,
 * given the `waitedMs` the request has already spent asleep.
 *
 * The delay is core's; what this adds is the two bounds a process holding a
 * claim needs. A wait that would breach the ceiling returns the failure
 * WITHOUT sleeping first: a partial wait spends the claim and still fails.
 */
function nextStep(failure: FailureClass, attempt: number, now: Date, waitedMs: number): NextStep {
    if (attempt + 1 >= attemptCap(failure.kind)) return { step: "return" };
    const advice = retryAdvice(failure, attempt, Math.floor(now.getTime() / 1000));
    if (advice.action === "doNotRetry") return { step: "return" };
    if (advice.action === "refreshTokenAndRetry") return { step: "refreshToken" };
    const ms = advice.ms + jitterMs(failure.kind, advice.ms, now);
    return waitedMs + ms > MAX_RETRY_WAIT_MS ? { step: "return" } : { step: "wait", ms };
}

// ─── The representation cache ────────────────────────────────────────

/** A retained body and the validator plus variant that make it reusable. */
interface CachedRepresentation {
    readonly etag: string;
    readonly variant: string;
    readonly body: string;
    readonly headers: Readonly<Record<string, string>>;
}

/** The bounded, least-recently-used store of reusable representations. */
interface RepresentationCache {
    /** The entry for this URL under this variant, made newest by the read. */
    lookup(url: string, variant: string): CachedRepresentation | undefined;
    store(url: string, entry: CachedRepresentation): void;
    remove(url: string): void;
    /** That URL and its query-string variants — one resource read many ways. */
    removeResource(url: string): void;
}

function createRepresentationCache(): RepresentationCache {
    const entries = new Map<string, CachedRepresentation>();
    let retainedBytes = 0;

    const remove = (url: string): void => {
        const entry = entries.get(url);
        if (entry !== undefined) {
            retainedBytes -= entry.body.length;
            entries.delete(url);
        }
    };

    return {
        lookup(url: string, variant: string): CachedRepresentation | undefined {
            const entry = entries.get(url);
            if (entry === undefined || entry.variant !== variant) return undefined;
            // Reading an entry makes it newest in the bounded LRU.
            entries.delete(url);
            entries.set(url, entry);
            return entry;
        },
        /** Insert as newest, then evict oldest-first until under both bounds. */
        store(url: string, entry: CachedRepresentation): void {
            remove(url);
            entries.set(url, entry);
            retainedBytes += entry.body.length;
            while (
                entries.size > DEFAULT_ETAG_CACHE_ENTRIES ||
                retainedBytes > DEFAULT_ETAG_CACHE_BYTES
            ) {
                // `size > a non-negative limit` proves an entry exists, and the
                // per-entry byte cap proves a one-entry cache is under the total.
                remove(entries.keys().next().value as string);
            }
        },
        remove,
        removeResource(url: string): void {
            for (const key of [...entries.keys()]) {
                if (key === url || key.startsWith(`${url}?`)) remove(key);
            }
        },
    };
}

function representationHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
    const link = headers.link;
    return link === undefined ? {} : { link };
}

// ─── The client ──────────────────────────────────────────────────────

function rateLimitHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
    return Object.fromEntries(
        Object.entries(headers).filter(([name]) => name.startsWith("x-ratelimit-")),
    );
}

/**
 * The response body as text, or `null` when it passed the bound.
 *
 * Read chunk by chunk rather than through `response.text()`: the bound has to
 * stop an oversized body from being buffered, and a length checked after the
 * fact has already cost the memory it was meant to refuse. The decoder is
 * driven in streaming mode so a multi-byte character split across two chunks
 * survives.
 */
async function boundedText(response: Response): Promise<string | null> {
    const stream = response.body;
    if (stream === null) return "";
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let text = "";
    let bytes = 0;
    for (;;) {
        const chunk = await reader.read();
        if (chunk.done) return text + decoder.decode();
        bytes += chunk.value.length;
        if (bytes > MAX_RESPONSE_BODY_BYTES) {
            try {
                await reader.cancel();
            } catch {
                // The bound is what matters here, not a tidy close.
            }
            return null;
        }
        text += decoder.decode(chunk.value, { stream: true });
    }
}

/** Ready-to-send headers and the variant they select, or the refusal. */
type PreparedHeaders =
    | { readonly ok: true; readonly headers: Headers; readonly variant: string }
    | { readonly ok: false; readonly refusal: GitHubFailure };

/**
 * The operation's headers with the controlled fields installed.
 *
 * Controlled fields never select a representation: caller values for them
 * are deleted before the variant is derived, then ours are installed.
 */
function prepareHeaders(request: GitHubRequest, token: InstallationToken): PreparedHeaders {
    let headers: Headers;
    try {
        headers = new Headers(request.headers);
    } catch {
        return { ok: false, refusal: notSentFailure("invalidHeaders") };
    }
    headers.set("accept", headers.get("accept") ?? DEFAULT_ACCEPT);
    headers.delete("authorization");
    headers.delete("if-none-match");
    headers.delete("user-agent");
    headers.delete("x-github-api-version");
    // A content type describes a body. The label removal is a DELETE with
    // none, and declaring one there would describe nothing.
    if (bodyOf(request) !== undefined) {
        headers.delete("content-length");
        headers.set("content-type", "application/json");
    }
    const variant = JSON.stringify(headersToRecord(headers));
    try {
        headers.set("authorization", `Bearer ${token.value}`);
        headers.set("user-agent", USER_AGENT);
        headers.set("x-github-api-version", GITHUB_API_VERSION);
    } catch {
        // Our two constants are known-good header values; only the token
        // value can make this throw.
        return { ok: false, refusal: brokenSeamFailure("tokenValue") };
    }
    return { ok: true, headers, variant };
}

/** A settled promise's value discarded — both arms of "that one finished". */
const settled = (): undefined => undefined;

export function createGitHubHttpClient({
    tokenSource,
    fetch: send = fetch,
    clock = () => new Date(),
    sleep = wait,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    timeoutSignal = AbortSignal.timeout,
}: GitHubHttpClientOptions): GitHubHttpClient {
    const cache = createRepresentationCache();
    let latestRateLimit: RateLimitSnapshot | null = null;

    const rememberRateLimit = (
        url: string,
        status: number,
        headers: Readonly<Record<string, string>>,
    ): void => {
        latestRateLimit = { url, status, headers: rateLimitHeaders(headers) };
    };

    /**
     * The exhaustion the NEXT request should assume, from what the last
     * response said — the one consumer of the rate snapshot.
     *
     * `remaining` is parsed with the seconds parser because GitHub spells it
     * with the same whole-number grammar, and permissive coercion would turn
     * a malformed count into a confident zero. A count with no usable reset is
     * ignored: pacing on it could never expire, and would wedge the client
     * behind a response it has stopped sending.
     */
    const pacingClass = (): FailureClass | null => {
        if (latestRateLimit === null) return null;
        const remaining = parseSecondsHeader(latestRateLimit.headers["x-ratelimit-remaining"]);
        const resetAt = latestRateLimit.headers["x-ratelimit-reset"];
        if (remaining.kind !== "valid" || remaining.seconds >= PRIMARY_BUDGET_RESERVE) return null;
        return parseSecondsHeader(resetAt).kind === "valid"
            ? { kind: "primaryExhausted", resetAt }
            : null;
    };

    const sendOnce = async (
        request: GitHubRequest,
        token: InstallationToken,
    ): Promise<GitHubOutcome> => {
        const prepared = prepareHeaders(request, token);
        if (!prepared.ok) return prepared.refusal;
        const { headers, variant } = prepared;
        const requestBody = bodyOf(request);

        // A write is never a GET, so it never carries a validator.
        const cached = request.method === "GET" ? cache.lookup(request.url, variant) : undefined;
        if (cached !== undefined) headers.set("if-none-match", cached.etag);

        // Capture the local age at send time. A later clock read could turn a
        // live request into a false `tokenExpired` diagnosis.
        let tokenPastExpiry: boolean;
        try {
            tokenPastExpiry = isPastExpiry(token, clock());
        } catch {
            return brokenSeamFailure("clock");
        }
        // A throwing timeout factory is a wiring defect, not retriable weather.
        let signal: AbortSignal;
        try {
            signal = timeoutSignal(timeoutMs);
        } catch {
            return brokenSeamFailure("timeoutSignal");
        }
        const init: RequestInit = {
            method: request.method,
            headers,
            // Following is deliberately not delegated to fetch: hidden 3xx
            // calls would evade origin validation, rate tracking, failure
            // classification, and the two-attempt bound.
            redirect: "manual",
            signal,
            ...(requestBody === undefined ? {} : { body: requestBody }),
        };

        let response: Response;
        try {
            response = await send(request.url, init);
        } catch {
            return transportFailure();
        }

        const responseHeaders = headersToRecord(response.headers);
        rememberRateLimit(request.url, response.status, responseHeaders);

        if (response.status === 304) {
            // A 304 with nothing to reuse: the entry was evicted mid-flight,
            // or the server misbehaved. Either way a full re-read fixes it.
            if (cached === undefined) {
                return {
                    ok: false,
                    status: response.status,
                    body: "",
                    headers: responseHeaders,
                    failure: { kind: "transient" },
                };
            }
            return {
                ok: true,
                status: response.status,
                body: cached.body,
                headers: { ...cached.headers, ...responseHeaders },
                fromCache: true,
            };
        }

        let read: string | null;
        try {
            read = await boundedText(response);
        } catch {
            return {
                ok: false,
                status: response.status,
                headers: responseHeaders,
                failure: { kind: "transient" },
            };
        }
        if (read === null) {
            return {
                ok: false,
                status: response.status,
                headers: responseHeaders,
                failure: { kind: "responseTooLarge", limitBytes: MAX_RESPONSE_BODY_BYTES },
            };
        }
        const body = read;

        if (response.ok) {
            // Only a 200 speaks about the representation; a 202 or 204 must
            // not evict a validator that is still good.
            if (response.status === 200 && request.method === "GET") {
                const etag = response.headers.get("etag");
                if (etag !== null && body.length <= DEFAULT_ETAG_CACHE_ENTRY_BYTES) {
                    cache.store(request.url, {
                        etag,
                        variant,
                        body,
                        headers: representationHeaders(responseHeaders),
                    });
                } else {
                    // A 200 with no retainable validator leaves any kept entry stale.
                    cache.remove(request.url);
                }
            }
            return {
                ok: true,
                status: response.status,
                body,
                headers: responseHeaders,
                fromCache: false,
            };
        }

        return {
            ok: false,
            status: response.status,
            body,
            headers: responseHeaders,
            failure: classifyFailure({
                status: response.status,
                body,
                headers: responseHeaders,
                tokenPastExpiry,
            }),
        };
    };

    /**
     * The content-creation lane: one comment creation at a time, spaced by at
     * least `CONTENT_CREATION_SPACING_MS`.
     *
     * The lane holds until the request FINISHES, not until the spacing wait
     * ends, so two creations never overlap in flight — a burst is what 6.4
     * tripped, and spacing alone would still let a burst leave together.
     *
     * The wait is not retry budget: it happens before anything is sent, so it
     * cannot spend a claim on a failure, and it is bounded by the spacing
     * itself rather than by `MAX_RETRY_WAIT_MS`.
     */
    let creationLane: Promise<void> = Promise.resolve();
    let lastCreationAt: number | null = null;

    /** Wait out this creation's turn, or name the seam that broke. */
    const spaceCreation = async (): Promise<GitHubFailure | null> => {
        let startedAt: number;
        try {
            startedAt = clock().getTime();
        } catch {
            return brokenSeamFailure("clock");
        }
        const due = lastCreationAt === null ? 0 : lastCreationAt + CONTENT_CREATION_SPACING_MS;
        if (due > startedAt) {
            try {
                await sleep(due - startedAt);
            } catch {
                return brokenSeamFailure("sleep");
            }
        }
        try {
            lastCreationAt = clock().getTime();
        } catch {
            return brokenSeamFailure("clock");
        }
        return null;
    };

    const throughCreationLane = (work: () => Promise<GitHubOutcome>): Promise<GitHubOutcome> => {
        const run = creationLane.then(async (): Promise<GitHubOutcome> => {
            const broken = await spaceCreation();
            return broken ?? work();
        });
        // The lane tracks completion, not success: a failure is this request's
        // outcome, and must not wedge the next creation either way.
        creationLane = run.then(settled, settled);
        return run;
    };

    return {
        async request(request): Promise<GitHubOutcome> {
            const admitted = admit(request);
            if (!admitted.ok) return admitted.refusal;
            const safeRequest = admitted.request;
            const write = admitted.write;
            const retriable = mayRetryInClient(safeRequest);

            let waitedMs = 0;
            /** This request's next move, or the broken clock that ends it. */
            const move = (failure: FailureClass, attempt: number): NextStep | "brokenClock" => {
                let now: Date;
                try {
                    now = clock();
                } catch {
                    return "brokenClock";
                }
                return nextStep(failure, attempt, now, waitedMs);
            };
            /** Pause, spending the wait from this request's own ceiling. */
            const rest = async (ms: number): Promise<GitHubFailure | null> => {
                waitedMs += ms;
                try {
                    await sleep(ms);
                } catch {
                    return brokenSeamFailure("sleep");
                }
                return null;
            };

            /** Pace, then send until this request's own policy says stop. */
            const deliver = async (): Promise<GitHubOutcome> => {
                // Pacing runs once, before the first send: inside a request the
                // server's own advice already governs, and a retry that paused
                // twice would spend the ceiling on one failure. It is not a
                // retry, so a non-idempotent write waits here like anything else.
                const paced = pacingClass();
                if (paced !== null) {
                    const step = move(paced, 0);
                    if (step === "brokenClock") return brokenSeamFailure("clock");
                    if (step.step !== "wait") return { ok: false, failure: paced };
                    const broken = await rest(step.ms);
                    if (broken !== null) return broken;
                }

                for (let attempt = 0; ; attempt += 1) {
                    let tokenOutcome: TokenOutcome;
                    try {
                        tokenOutcome = await tokenSource.current();
                        if (!isWellFormedTokenOutcome(tokenOutcome)) {
                            return brokenSeamFailure("tokenSource");
                        }
                    } catch {
                        // `current()` promises not to throw.
                        return brokenSeamFailure("tokenSource");
                    }
                    if (!tokenOutcome.ok) return tokenOutcome;
                    const missing = missingGrants(safeRequest, tokenOutcome.token);
                    if (missing.length > 0) {
                        return {
                            ok: false,
                            failure: {
                                kind: "permissionMissing",
                                acceptedPermissions: missing.join(", "),
                            },
                        };
                    }

                    let outcome: GitHubOutcome;
                    try {
                        outcome = await sendOnce(safeRequest, tokenOutcome.token);
                    } catch {
                        // `sendOnce()` contains expected transport failures itself;
                        // what escapes it is a response object that broke mid-read.
                        return brokenSeamFailure("response");
                    }
                    if (outcome.ok) return outcome;
                    const responseClass = responseClassOf(outcome.failure);
                    if (responseClass === null) return outcome;
                    // A rejected token is dropped even on the final attempt, so
                    // the next `request()` starts on a fresh mint.
                    if (responseClass.kind === "tokenExpired") {
                        try {
                            tokenSource.invalidate(tokenOutcome.token);
                        } catch {
                            return brokenSeamFailure("invalidate");
                        }
                    }
                    if (!retriable) return outcome;
                    const step = move(responseClass, attempt);
                    if (step === "brokenClock") return brokenSeamFailure("clock");
                    if (step.step === "return") return outcome;
                    if (step.step === "wait") {
                        const broken = await rest(step.ms);
                        if (broken !== null) return broken;
                    }
                }
            };

            const outcome =
                write?.endpoint === "createComment"
                    ? await throughCreationLane(deliver)
                    : await deliver();

            // Drop the validators a landed write staled — see the shapes'
            // `invalidates` in `operations/`.
            // The test is "may have reached GitHub", not "succeeded": an
            // ambiguous outcome is exactly when a read-back runs next, and a
            // 304 answered from a PRE-write body would let it conclude
            // "absent" about a change that landed. That is the duplicate D46
            // exists to prevent, so the one full re-read is the price.
            if (write !== null && (outcome.ok || outcome.failure.kind !== "notSent")) {
                for (const url of write.invalidates) cache.removeResource(url);
            }
            return outcome;
        },
        latestRateLimit(): RateLimitSnapshot | null {
            if (latestRateLimit === null) return null;
            return {
                ...latestRateLimit,
                headers: { ...latestRateLimit.headers },
            };
        },
    };
}
