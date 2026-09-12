/**
 * What one write operation's transport is: the endpoints it may reach and the
 * verbs it contributes.
 *
 * This file is the contract half of `operations/`. No operation's own facts
 * live here, nothing here imports a sibling module, and `contract.ts` is the
 * only thing below it. A shape and a builder for the same endpoint are two
 * SPELLINGS on purpose: the gate matches a URL structurally and never derives
 * its match from the builder's string, so a gate that trusted the builder
 * would not be a gate (D129). Keeping both in one operation module makes that
 * review one screen instead of two files; it does not make them one fact.
 *
 * In order below: the endpoints and the judgements a shape matches with, the
 * verb surface and the seam a builder sends through, and the transport that
 * holds both.
 */

import type { ItemRef, RepositoryRef } from "@hiero-hackers/automation-core";
import { GITHUB_API_ORIGIN, repoPath, type GitHubWriteRequest } from "../contract.js";

// ─── The endpoints ───────────────────────────────────────────────────

/** The four write operations the endpoint matrix confirmed, by path shape. */
export type WriteEndpoint = "addLabel" | "removeLabel" | "createComment" | "updateComment";

/**
 * One path segment spelled the way `repoPath` spells one: non-empty, and
 * unchanged by a decode-then-encode round trip.
 *
 * Matching a write URL structurally means matching what this package itself
 * builds. A segment that does not round-trip was double-encoded, or carries a
 * character `encodeURIComponent` never emits — either way it is not ours, and
 * a gate that accepted it would be matching a path shape nobody wrote.
 */
export function isEncodedSegment(segment: string | undefined): boolean {
    if (segment === undefined || segment.length === 0) return false;
    try {
        return encodeURIComponent(decodeURIComponent(segment)) === segment;
    } catch {
        return false;
    }
}

/** A positive decimal item id, in the one spelling GitHub's paths use. */
export function isNumberSegment(segment: string | undefined): boolean {
    return segment !== undefined && /^[1-9][0-9]*$/.test(segment);
}

/**
 * One endpoint an operation is allowed to reach.
 *
 * `matches` judges only the method and `rest` — the path's tail past
 * `repos/{owner}/{repo}/issues` — because the preamble every shape shares is
 * checked once by the walk that calls this.
 */
export interface EndpointShape {
    readonly endpoint: WriteEndpoint;
    /** Structural match on method and the path's tail — never derived from the builder. */
    matches(method: string, rest: readonly string[]): boolean;
    /** Cache keys a landed write makes untrustworthy. */
    invalidates(url: URL): readonly string[];
}

/**
 * The keys a write against one item stales: the item, one of its two lists,
 * and its timeline.
 *
 * Keys are whole hrefs, so these are RESOURCE prefixes and the cache drops
 * each one's query-string variants too (`…/comments` and
 * `…/comments?per_page=100&page=1` are one resource read two ways). The
 * timeline carries both a label event and a comment event, so every write
 * against an item stales it. The item itself is the first five segments of a
 * path a shape has already proved.
 *
 * What it cannot reach, and neither can any honest version of it. A list page
 * that merely CONTAINS the item — `…/issues?labels=…` — is a different
 * resource under a filter this cannot enumerate. And the cache is per client
 * instance: another process holds its own.
 */
export function itemStaledBy(url: URL, list: "comments" | "labels"): readonly string[] {
    const item = `${GITHUB_API_ORIGIN}${url.pathname.split("/").slice(0, 6).join("/")}`;
    return [item, `${item}/${list}`, `${item}/timeline`];
}

// ─── The verbs ───────────────────────────────────────────────────────

/**
 * What one write turned out to be.
 *
 * `applied` is the postcondition holding because we made it hold; `already` is
 * it holding without us. Only the label removal can ever report `already` —
 * see `NotFoundMeaning` for why the other three cannot.
 */
export type WriteResult =
    | { readonly outcome: "applied" }
    | { readonly outcome: "already" }
    | { readonly outcome: "conflict"; readonly detail: string }
    | { readonly outcome: "forbidden"; readonly detail: string }
    | { readonly outcome: "retryLater"; readonly detail: string }
    | { readonly outcome: "unknown"; readonly detail: string };

/** The four confirmed write operations, and nothing else. */
export interface WriteVerbs {
    /** Add one named label. Idempotent: adding a label already there is a no-op. */
    addLabel(item: ItemRef, label: string): Promise<WriteResult>;
    /** Remove ONE named label. There is no remove-by-prefix here or below (D4). */
    removeLabel(item: ItemRef, label: string): Promise<WriteResult>;
    /** Create a comment. The one non-idempotent verb, and the reason 6.5 exists. */
    createComment(item: ItemRef, body: string): Promise<WriteResult>;
    /** Replace a comment's body, by the comment id the read-back found. */
    updateComment(commentId: number, body: string): Promise<WriteResult>;
}

/**
 * What a 404 means at this endpoint — the one status the four disagree about.
 *
 * `invisible`: the item is gone or was never visible, and GitHub hides which
 * (matrix, "Repo outside installation"). Nothing landed and nothing will.
 *
 * `labelMayBeAbsent`: the same 404 ALSO covers the desired postcondition —
 * removing a label the item does not carry. The two are separated by GitHub's
 * prose in `writes.ts`, and the fallback when the prose does not match is
 * `invisible`, never `already`: claiming a postcondition nobody observed is
 * the error that lets a wrong "absent" stand (D46).
 */
export type NotFoundMeaning = "invisible" | "labelMayBeAbsent";

/**
 * What one verb builder may use: the repository it writes to, and the one
 * send-and-classify mechanism every verb ends in.
 *
 * `apply` is `writes.ts`'s, so a builder states a request and a word and
 * nothing else. Nothing a builder receives is validated: a label with no name,
 * a negative comment id, an item number that is not one — each builds a URL
 * the admission gate refuses structurally, and a refusal is already a
 * `forbidden` result.
 */
export interface VerbContext {
    readonly repository: RepositoryRef;
    apply(request: GitHubWriteRequest, notFound: NotFoundMeaning): Promise<WriteResult>;
}

/** The one spelling of an item's API path, for every verb that names one. */
export function issuePath(repository: RepositoryRef, item: ItemRef): string {
    return `${repoPath(repository)}/issues/${String(item.number)}`;
}

// ─── The transport ───────────────────────────────────────────────────

/** One operation's whole reach into GitHub: what it may match, what it may send. */
export interface OperationTransport {
    /** The endpoints this operation is allowed to reach — empty is a legal, refusing transport. */
    readonly endpoints: readonly EndpointShape[];
    /** The verbs this operation contributes to the write surface. */
    verbs(context: VerbContext): Partial<WriteVerbs>;
}
