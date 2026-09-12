/**
 * The endpoint-permission matrix as code: may this request be sent?
 *
 * Every request passes this gate before a token is acquired, so a refusal
 * never costs a mint, and the URL leaves normalised so everything downstream
 * sees one spelling. What it judges is structural — the pinned origin, the one
 * GraphQL query this package may POST, and the write endpoints
 * `design/findings/endpoint-permission-matrix.md` confirmed, matched by path
 * SHAPE rather than by text. The shapes belong to the operations that reach
 * them, so this file asks the registry in `operations/` and spells no path of
 * its own. It answers the permission half of the same question too: the grants
 * a request needs and its token does not carry.
 *
 * A write that passes carries one more answer out — the cache keys its landing
 * makes untrustworthy. Nothing here sends anything, waits, or reads a
 * response: that is `http.ts`, this file's only caller. The vocabulary it
 * refuses in is `contract.ts`.
 *
 * In order below: the admitted request, then the grants.
 */

import type { PermissionGrant } from "@hiero-hackers/automation-core";
import {
    bodyOf,
    GITHUB_API_ORIGIN,
    GITHUB_GRAPHQL_URL,
    isWrite,
    notSentFailure,
    type GitHubFailure,
    type GitHubGraphqlRequest,
    type GitHubRequest,
    type GitHubWriteRequest,
    type NotSentReason,
} from "./contract.js";
import { writeEndpointOf } from "./operations/index.js";
import type { WriteEndpoint } from "./operations/transport.js";
import type { InstallationToken } from "./token.js";
import { jsonRecordOf } from "./untrusted.js";

// ─── The admitted request ────────────────────────────────────────────

type GitHubApiUrl =
    | { readonly ok: true; readonly url: URL }
    | { readonly ok: false; readonly refused: "malformedUrl" | "disallowedOrigin" };

function githubApiUrl(rawUrl: string): GitHubApiUrl {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        return { ok: false, refused: "malformedUrl" };
    }
    return url.origin === GITHUB_API_ORIGIN
        ? { ok: true, url }
        : { ok: false, refused: "disallowedOrigin" };
}

/** What admitting a write learned, for the client's retry policy and its cache. */
export interface AdmittedWrite {
    readonly endpoint: WriteEndpoint;
    readonly invalidates: readonly string[];
}

/** A request as it may be sent, or the refusal that stops it here. */
export type AdmittedRequest =
    | {
          readonly ok: true;
          readonly request: GitHubRequest;
          readonly write: AdmittedWrite | null;
      }
    | { readonly ok: false; readonly refusal: GitHubFailure };

const refused = (reason: Exclude<NotSentReason, "brokenSeam">): AdmittedRequest => ({
    ok: false,
    refusal: notSentFailure(reason),
});

/**
 * The one GraphQL query this package may POST, checked before it is sent.
 * Nothing else may reach `/graphql`, and this operation may reach nothing else.
 */
function admitGraphql(request: GitHubGraphqlRequest, url: URL): AdmittedRequest {
    if (url.href !== GITHUB_GRAPHQL_URL) return refused("disallowedMethod");
    if (typeof request.body !== "string") return refused("invalidBody");
    try {
        const body = JSON.parse(request.body) as Record<string, unknown>;
        if (
            body.operationName !== "LinkedIssues" ||
            typeof body.query !== "string" ||
            !/^\s*query\s+LinkedIssues(?:\s|\()/.test(body.query)
        ) {
            return refused("invalidBody");
        }
    } catch {
        return refused("invalidBody");
    }
    return { ok: true, request: { ...request, url: url.href }, write: null };
}

/**
 * A write against the per-endpoint allowlist.
 *
 * The body rule is per endpoint rather than per method, because the four
 * endpoints disagree: three carry a JSON object and the label removal carries
 * nothing. A body where none belongs is refused rather than dropped — sending
 * a request the caller did not write is worse than not sending it.
 */
function admitWrite(request: GitHubWriteRequest, url: URL): AdmittedRequest {
    const write = writeEndpointOf(request.method, url);
    if (write === null) return refused("disallowedMethod");
    // Unreachable through the type, and the retry policy reads this field.
    // A declaration that is neither word is a malformed request, not a write.
    if (request.idempotency !== "idempotent" && request.idempotency !== "nonIdempotent") {
        return refused("invalidBody");
    }
    const body = bodyOf(request);
    if (write.endpoint === "removeLabel") {
        if (body !== undefined) return refused("invalidBody");
    } else {
        if (body === undefined || jsonRecordOf(body) === null) return refused("invalidBody");
    }
    return { ok: true, request: { ...request, url: url.href }, write };
}

/**
 * The gate every request passes before a token is acquired: the admitted
 * methods, the pinned origin, the one GraphQL query this package may POST, and
 * the four write endpoints the matrix confirmed.
 *
 * It runs first so a refusal never costs a mint, and it normalises the URL so
 * everything downstream — the cache key included — sees one spelling.
 */
export function admit(request: GitHubRequest): AdmittedRequest {
    const write = isWrite(request);
    if (!write && request.method !== "GET" && request.method !== "POST") {
        return refused("disallowedMethod");
    }
    const parsed = githubApiUrl(request.url);
    if (!parsed.ok) return refused(parsed.refused);
    if (write) return admitWrite(request, parsed.url);
    if (request.method === "POST") return admitGraphql(request, parsed.url);
    return { ok: true, request: { ...request, url: parsed.url.href }, write: null };
}

// ─── The grants ──────────────────────────────────────────────────────

const LINKED_ISSUES_GRANTS: readonly PermissionGrant[] = ["issues:read", "pull_requests:read"];

/** Every admitted write is an issue-surface write; nothing weaker allows one. */
const WRITE_GRANT: PermissionGrant = "issues:write";

function hasReadGrant(token: InstallationToken, required: PermissionGrant): boolean {
    const write = `${required.slice(0, -4)}write`;
    return token.grants.some((grant) => grant === required || grant === write);
}

/**
 * Grants this request needs and the token does not carry.
 *
 * The read-side precheck (D123) is the pattern; what differs is what counts as
 * enough. A read is satisfied by the matching write grant, because write
 * implies read. A write is satisfied by nothing weaker than itself, so the
 * check is equality and the accepted permission it reports is the exact grant
 * an installation would have to add.
 */
export function missingGrants(
    request: GitHubRequest,
    token: InstallationToken,
): readonly PermissionGrant[] {
    if (isWrite(request)) {
        return token.grants.some((grant) => grant === WRITE_GRANT) ? [] : [WRITE_GRANT];
    }
    if (request.method !== "POST") return [];
    return LINKED_ISSUES_GRANTS.filter((grant) => !hasReadGrant(token, grant));
}
