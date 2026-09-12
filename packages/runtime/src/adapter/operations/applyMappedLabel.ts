/**
 * The mapped-label operation's transport: the two label endpoints, and the two
 * verbs that reach them.
 *
 * Realising a position adds one label and removes the one the item previously
 * held, so both endpoints belong to this operation and both are idempotent.
 */

import {
    isEncodedSegment,
    isNumberSegment,
    issuePath,
    itemStaledBy,
    type EndpointShape,
    type OperationTransport,
    type VerbContext,
    type WriteVerbs,
} from "./transport.js";

/** `POST …/issues/{n}/labels` — the item's label list, added to. */
const ADD_LABEL: EndpointShape = {
    endpoint: "addLabel",
    matches: (method, rest) =>
        method === "POST" && rest.length === 2 && isNumberSegment(rest[0]) && rest[1] === "labels",
    invalidates: (url) => itemStaledBy(url, "labels"),
};

/**
 * `DELETE …/issues/{n}/labels/{name}` — one named label, removed.
 *
 * D4 is enforced by this shape rather than by a check: the only removal
 * admitted names one label. GitHub's remove-every-label endpoint (the same
 * path without `{name}`) matches nothing here, so "remove by prefix" cannot be
 * expressed through this client.
 */
const REMOVE_LABEL: EndpointShape = {
    endpoint: "removeLabel",
    matches: (method, rest) =>
        method === "DELETE" &&
        rest.length === 3 &&
        isNumberSegment(rest[0]) &&
        rest[1] === "labels" &&
        isEncodedSegment(rest[2]),
    invalidates: (url) => itemStaledBy(url, "labels"),
};

/** The mapped-label operation's endpoints and verbs. */
export const APPLY_MAPPED_LABEL = {
    endpoints: [ADD_LABEL, REMOVE_LABEL],
    verbs: (context: VerbContext): Pick<WriteVerbs, "addLabel" | "removeLabel"> => ({
        addLabel: (item, label) =>
            context.apply(
                {
                    url: `${issuePath(context.repository, item)}/labels`,
                    method: "POST",
                    body: JSON.stringify({ labels: [label] }),
                    idempotency: "idempotent",
                },
                "invisible",
            ),
        removeLabel: (item, label) =>
            context.apply(
                {
                    url: `${issuePath(context.repository, item)}/labels/${encodeURIComponent(label)}`,
                    method: "DELETE",
                    idempotency: "idempotent",
                },
                "labelMayBeAbsent",
            ),
    }),
} satisfies OperationTransport;
