/**
 * The unlockIssue operation's transport: no endpoints, no verbs.
 *
 * `DELETE /repos/{o}/{r}/issues/{n}/lock` is uncited in the endpoint matrix
 * exactly as its mirror is. See `lockIssue.ts`.
 */

import type { OperationTransport } from "./transport.js";

/** The unlockIssue operation's endpoints and verbs, both empty today. */
export const UNLOCK_ISSUE = {
    endpoints: [],
    verbs: () => ({}),
} satisfies OperationTransport;
