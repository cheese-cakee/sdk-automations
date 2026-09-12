/**
 * The registry: one transport per operation, and the two walks over it.
 *
 * `TRANSPORTS` is the only place the operations are listed, so an operation
 * the catalogue names and this file does not is a compile error here rather
 * than a gap discovered at send. `admission.ts` reads the shapes through
 * `writeEndpointOf` and `writes.ts` composes the builders through
 * `writeVerbsOf`; neither knows which operation owns which endpoint. This
 * directory owns the endpoints and the verbs and nothing else — not whether a
 * request may be sent, not what GitHub's answer means, not how it travels —
 * and `contract.ts` is the only thing below it (write-operations.md §4).
 *
 * ADDING ONE is three edits: the endpoint names into `WriteEndpoint` in
 * `transport.ts`, a module with a shape per endpoint and a `verbs` builder
 * typed `Pick<WriteVerbs, …>` and asserted `satisfies OperationTransport`, and
 * one line here plus its verbs spread into `writeVerbsOf`. An operation the
 * write surface cannot reach is still a transport, with no endpoints and no
 * verbs — which is why the shell refuses that verb at send.
 *
 * THE TWO-SPELLINGS RULE: a shape matches a URL and a builder writes one, and
 * they are two spellings on purpose — a gate deriving its match from the
 * builder's string would not be a gate (D129). Never refactor a matcher to
 * call a builder or the other way. Two consequences before editing a shape:
 * the preamble every shape shares — no query, no fragment,
 * `repos/{owner}/{repo}/issues`, both names encoded — is checked once in the
 * walk below, so a shape sees only the method and the path's tail; and D4 is
 * enforced BY a shape, since the only removal admitted names one label, so
 * remove-by-prefix cannot be expressed through this client at all.
 */

import type { IntentOperation } from "@hiero-hackers/automation-core";
import { APPLY_MAPPED_LABEL } from "./applyMappedLabel.js";
import { ASSIGN } from "./assign.js";
import { CLOSE_PULL_REQUEST } from "./closePullRequest.js";
import { LOCK_ISSUE } from "./lockIssue.js";
import { POST_MANAGED_COMMENT } from "./postManagedComment.js";
import { RELEASE_ASSIGNMENT } from "./releaseAssignment.js";
import {
    isEncodedSegment,
    type OperationTransport,
    type VerbContext,
    type WriteEndpoint,
    type WriteVerbs,
} from "./transport.js";
import { UNASSIGN } from "./unassign.js";
import { UNLOCK_ISSUE } from "./unlockIssue.js";

/** Every write operation's transport, keyed by the operation core names. */
export const TRANSPORTS: { readonly [K in IntentOperation]: OperationTransport } = {
    postManagedComment: POST_MANAGED_COMMENT,
    applyMappedLabel: APPLY_MAPPED_LABEL,
    assign: ASSIGN,
    unassign: UNASSIGN,
    releaseAssignment: RELEASE_ASSIGNMENT,
    closePullRequest: CLOSE_PULL_REQUEST,
    lockIssue: LOCK_ISSUE,
    unlockIssue: UNLOCK_ISSUE,
};

/**
 * The write endpoint this method and path ARE, and what its landing stales, or
 * `null` for anything else.
 *
 * Structural, not textual: the path is split into segments, the literals must
 * be literal, and every variable segment must be a number or a
 * `repoPath`-encoded name. A query string or fragment disqualifies a write
 * outright — none of the endpoints takes one, and a parameter is how an
 * admitted shape would grow a second meaning.
 *
 * The preamble every shape shares is checked HERE, once: no query, no
 * fragment, `repos/{owner}/{repo}/issues`, and both names encoded. Each shape
 * then judges only the method and `rest`, the tail past those four segments.
 * A shape that re-checked the preamble could disagree with this one.
 */
export function writeEndpointOf(
    method: string,
    url: URL,
): { readonly endpoint: WriteEndpoint; readonly invalidates: readonly string[] } | null {
    if (url.search !== "" || url.hash !== "") return null;
    const [repos, owner, repo, issues, ...rest] = url.pathname.split("/").slice(1);
    if (repos !== "repos" || issues !== "issues") return null;
    if (!isEncodedSegment(owner) || !isEncodedSegment(repo)) return null;

    for (const transport of Object.values(TRANSPORTS)) {
        for (const shape of transport.endpoints) {
            if (shape.matches(method, rest)) {
                return { endpoint: shape.endpoint, invalidates: shape.invalidates(url) };
            }
        }
    }
    return null;
}

/**
 * The whole write surface, composed from the verbs the transports contribute.
 *
 * Each transport's `verbs` is typed with the exact verb names it owns, so this
 * spread is checked against `WriteVerbs` rather than merged into it: a verb the
 * interface declares and no transport builds fails to compile right here.
 */
export function writeVerbsOf(context: VerbContext): WriteVerbs {
    return {
        ...APPLY_MAPPED_LABEL.verbs(context),
        ...POST_MANAGED_COMMENT.verbs(context),
        ...ASSIGN.verbs(),
        ...UNASSIGN.verbs(),
        ...RELEASE_ASSIGNMENT.verbs(),
        ...CLOSE_PULL_REQUEST.verbs(),
        ...LOCK_ISSUE.verbs(),
        ...UNLOCK_ISSUE.verbs(),
    };
}
