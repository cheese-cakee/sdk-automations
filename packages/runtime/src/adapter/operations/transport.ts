/** What one write operation's transport is: the endpoints it may reach and the verbs it contributes. */

import type { ItemRef, RepositoryRef } from "@hiero-hackers/automation-core";
import { GITHUB_API_ORIGIN, repoPath, type GitHubWriteRequest } from "../contract.js";

// ─── The endpoints ───────────────────────────────────────────────────

/** The four write operations the endpoint matrix confirmed, by path shape. */
export type WriteEndpoint = "addLabel" | "removeLabel" | "createComment" | "updateComment";

/** Non-empty, and unchanged by a decode-then-encode round trip. */
export function isEncodedSegment(segment: string | undefined): boolean {
    if (segment === undefined || segment.length === 0) return false;
    try {
        return encodeURIComponent(decodeURIComponent(segment)) === segment;
    } catch {
        return false;
    }
}

export function isNumberSegment(segment: string | undefined): boolean {
    return segment !== undefined && /^[1-9][0-9]*$/.test(segment);
}

export interface EndpointShape {
    readonly endpoint: WriteEndpoint;
    /** Structural match on method and the path's tail — never derived from the builder (D129). */
    matches(method: string, rest: readonly string[]): boolean;
    /** Cache keys a landed write makes untrustworthy. */
    invalidates(url: URL): readonly string[];
}

/** Whole-href resource prefixes: the item, one of its two lists, its timeline. */
export function itemStaledBy(url: URL, list: "comments" | "labels"): readonly string[] {
    const item = `${GITHUB_API_ORIGIN}${url.pathname.split("/").slice(0, 6).join("/")}`;
    return [item, `${item}/${list}`, `${item}/timeline`];
}

// ─── The verbs ───────────────────────────────────────────────────────

/** `applied` is the postcondition holding because we made it hold; `already` is it holding without us. */
export type WriteResult =
    | { readonly outcome: "applied" }
    | { readonly outcome: "already" }
    | { readonly outcome: "conflict"; readonly detail: string }
    | { readonly outcome: "forbidden"; readonly detail: string }
    | { readonly outcome: "retryLater"; readonly detail: string }
    | { readonly outcome: "unknown"; readonly detail: string };

export interface WriteVerbs {
    /** Idempotent: adding a label already there is a no-op. */
    addLabel(item: ItemRef, label: string): Promise<WriteResult>;
    /** ONE named label. There is no remove-by-prefix here or below (D4). */
    removeLabel(item: ItemRef, label: string): Promise<WriteResult>;
    /** The one non-idempotent verb. */
    createComment(item: ItemRef, body: string): Promise<WriteResult>;
    updateComment(commentId: number, body: string): Promise<WriteResult>;
}

/** The one status the four endpoints disagree about; the fallback is `invisible`, never `already` (D46). */
export type NotFoundMeaning = "invisible" | "labelMayBeAbsent";

/** Nothing a builder receives is validated; the admission gate refuses a bad URL structurally. */
export interface VerbContext {
    readonly repository: RepositoryRef;
    apply(request: GitHubWriteRequest, notFound: NotFoundMeaning): Promise<WriteResult>;
}

export function issuePath(repository: RepositoryRef, item: ItemRef): string {
    return `${repoPath(repository)}/issues/${String(item.number)}`;
}

// ─── The transport ───────────────────────────────────────────────────

export interface OperationTransport {
    /** Empty is a legal, refusing transport. */
    readonly endpoints: readonly EndpointShape[];
    verbs(context: VerbContext): Partial<WriteVerbs>;
}
