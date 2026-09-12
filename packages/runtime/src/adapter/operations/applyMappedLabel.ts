/** The mapped-label operation's transport: the two label endpoints and the two verbs. */

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
 * D4 is enforced by this shape: the only removal admitted names one label.
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
