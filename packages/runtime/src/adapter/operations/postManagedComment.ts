/** The comment operation's transport: the two comment endpoints and the two verbs. */

import { GITHUB_API_ORIGIN, repoPath } from "../contract.js";
import {
    isNumberSegment,
    issuePath,
    itemStaledBy,
    type EndpointShape,
    type OperationTransport,
    type VerbContext,
    type WriteVerbs,
} from "./transport.js";

/** `POST …/issues/{n}/comments` — the item's comment list, appended to. */
const CREATE_COMMENT: EndpointShape = {
    endpoint: "createComment",
    matches: (method, rest) =>
        method === "POST" &&
        rest.length === 2 &&
        isNumberSegment(rest[0]) &&
        rest[1] === "comments",
    invalidates: (url) => itemStaledBy(url, "comments"),
};

/**
 * `PATCH …/issues/comments/{id}` — the one write shape naming no item number.
 * Its landing stales a single key, so the issue's comment list survives an edit.
 */
const UPDATE_COMMENT: EndpointShape = {
    endpoint: "updateComment",
    matches: (method, rest) =>
        method === "PATCH" &&
        rest.length === 2 &&
        rest[0] === "comments" &&
        isNumberSegment(rest[1]),
    invalidates: (url) => [`${GITHUB_API_ORIGIN}${url.pathname}`],
};

export const POST_MANAGED_COMMENT = {
    endpoints: [CREATE_COMMENT, UPDATE_COMMENT],
    verbs: (context: VerbContext): Pick<WriteVerbs, "createComment" | "updateComment"> => ({
        createComment: (item, body) =>
            context.apply(
                {
                    url: `${issuePath(context.repository, item)}/comments`,
                    method: "POST",
                    body: JSON.stringify({ body }),
                    idempotency: "nonIdempotent",
                },
                "invisible",
            ),
        updateComment: (commentId, body) =>
            context.apply(
                {
                    url: `${repoPath(context.repository)}/issues/comments/${String(commentId)}`,
                    method: "PATCH",
                    body: JSON.stringify({ body }),
                    idempotency: "idempotent",
                },
                "invisible",
            ),
    }),
} satisfies OperationTransport;
