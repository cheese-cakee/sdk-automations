/**
 * The endpoint-permission matrix as code: may this request be sent, and with which grants?
 * Nothing here sends anything, waits, or reads a response; that is `http.ts`.
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
 * The one GraphQL query this package may POST.
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
 * The body rule is per endpoint, not per method: the label removal carries none.
 */
function admitWrite(request: GitHubWriteRequest, url: URL): AdmittedRequest {
    const write = writeEndpointOf(request.method, url);
    if (write === null) return refused("disallowedMethod");
    // Unreachable through the type, and the retry policy reads this field.

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
 * The admitted methods, the pinned origin, the one GraphQL query, the confirmed
 * write endpoints. It runs before a token is acquired, so a refusal costs no mint.
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

const LINKED_ISSUES_GRANTS: readonly PermissionGrant[] = ["issues:read", "pull_requests:read"];

/** Every admitted write is an issue-surface write; nothing weaker allows one. */
const WRITE_GRANT: PermissionGrant = "issues:write";

function hasReadGrant(token: InstallationToken, required: PermissionGrant): boolean {
    const write = `${required.slice(0, -4)}write`;
    return token.grants.some((grant) => grant === required || grant === write);
}

/**
 * Grants this request needs and the token does not carry.
 * A read is satisfied by the matching write grant; a write by nothing weaker (D123).
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
