/**
 * Every write verb as the request it sends: one row per verb of `WriteVerbs`, built
 * here and matched by the client's shapes (D129, D210). Nothing a builder receives
 * is validated; the admission gate refuses a bad URL structurally.
 */

import type {
    ItemRef,
    RepositoryRef,
    WriteResult,
    WriteVerbs,
} from "@hiero-hackers/automation-core";
import type { Allowance } from "../client/allowance.js";
import { repoPath, type GitHubWriteRequest } from "../client/contract.js";

/** The one status the endpoints disagree about; the fallback is `invisible`, never `already` (D46). */
export type NotFoundMeaning = "invisible" | "labelMayBeAbsent";

export function issuePath(repository: RepositoryRef, item: ItemRef): string {
    return `${repoPath(repository)}/issues/${String(item.number)}`;
}

/** The pull-request view of the same number — a different row, and a different grant. */
export function pullPath(repository: RepositoryRef, item: ItemRef): string {
    return `${repoPath(repository)}/pulls/${String(item.number)}`;
}

/** One verb's request, and what its 404 means. */
export interface BuiltWrite {
    readonly request: GitHubWriteRequest;
    readonly notFound: NotFoundMeaning;
}

/** A verb's arguments without the trailing allowance; `Required` makes that last element matchable. */
type Arguments<V extends keyof WriteVerbs> =
    Required<Parameters<WriteVerbs[V]>> extends [...infer Own, unknown] ? Own : never;

/** One builder per verb of `WriteVerbs`; a verb with no row fails to compile here. */
export const REQUESTS: {
    readonly [V in keyof WriteVerbs]: (
        repository: RepositoryRef,
        ...own: Arguments<V>
    ) => BuiltWrite;
} = {
    createLabel: (repository, label, color, description) => ({
        request: {
            url: `${repoPath(repository)}/labels`,
            method: "POST",
            body: JSON.stringify({ name: label, color, description }),
            idempotency: "nonIdempotent",
        },
        notFound: "invisible",
    }),
    addLabel: (repository, item, label) => ({
        request: {
            url: `${issuePath(repository, item)}/labels`,
            method: "POST",
            body: JSON.stringify({ labels: [label] }),
            idempotency: "idempotent",
        },
        notFound: "invisible",
    }),
    removeLabel: (repository, item, label) => ({
        request: {
            url: `${issuePath(repository, item)}/labels/${encodeURIComponent(label)}`,
            method: "DELETE",
            idempotency: "idempotent",
        },
        notFound: "labelMayBeAbsent",
    }),
    createComment: (repository, item, body) => ({
        request: {
            url: `${issuePath(repository, item)}/comments`,
            method: "POST",
            body: JSON.stringify({ body }),
            idempotency: "nonIdempotent",
        },
        notFound: "invisible",
    }),
    updateComment: (repository, commentId, body) => ({
        request: {
            url: `${repoPath(repository)}/issues/comments/${String(commentId)}`,
            method: "PATCH",
            body: JSON.stringify({ body }),
            idempotency: "idempotent",
        },
        notFound: "invisible",
    }),
    closePullRequest: (repository, item) => ({
        request: {
            url: pullPath(repository, item),
            method: "PATCH",
            body: JSON.stringify({ state: "closed" }),
            idempotency: "idempotent",
        },
        notFound: "invisible",
    }),
    releaseAssignment: (repository, item, login) => ({
        request: {
            url: `${issuePath(repository, item)}/assignees`,
            method: "DELETE",
            body: JSON.stringify({ assignees: [login] }),
            idempotency: "idempotent",
        },
        notFound: "invisible",
    }),
    lockIssue: (repository, item) => ({
        request: {
            url: `${issuePath(repository, item)}/lock`,
            method: "PUT",
            headers: { "content-length": "0" },
            idempotency: "idempotent",
        },
        notFound: "invisible",
    }),
    unlockIssue: (repository, item) => ({
        request: {
            url: `${issuePath(repository, item)}/lock`,
            method: "DELETE",
            idempotency: "idempotent",
        },
        notFound: "invisible",
    }),
};

/** The verbs, in row order, so a walk over the table is a walk over `WriteVerbs`. */
export const WRITE_VERBS = Object.keys(REQUESTS) as readonly (keyof WriteVerbs)[];

/** The one send-and-classify every verb ends in. */
export type Apply = (
    request: GitHubWriteRequest,
    notFound: NotFoundMeaning,
    allowance?: Allowance,
) => Promise<WriteResult>;

/**
 * The whole write surface from the table. THE ONE CAST: each verb's own
 * arguments precede its allowance, so the builder's arity splits them.
 */
export function writeVerbsOf(repository: RepositoryRef, apply: Apply): WriteVerbs {
    const verbs: Partial<Record<keyof WriteVerbs, unknown>> = {};
    for (const verb of WRITE_VERBS) {
        const build = REQUESTS[verb] as (
            repository: RepositoryRef,
            ...own: unknown[]
        ) => BuiltWrite;
        const arity = build.length - 1;
        verbs[verb] = (...args: unknown[]) => {
            const built = build(repository, ...args.slice(0, arity));
            return apply(built.request, built.notFound, args[arity] as Allowance | undefined);
        };
    }
    return verbs as WriteVerbs;
}
