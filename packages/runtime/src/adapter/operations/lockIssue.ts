/**
 * The lockIssue operation's transport: no endpoints, no verbs.
 *
 * `PUT /repos/{o}/{r}/issues/{n}/lock` is not a row of
 * `design/findings/endpoint-permission-matrix.md`, and that page's own first
 * line is that a row without a citation does not close the gate. So the
 * operation is a registered, refusing transport — the `unassign` shape — and
 * the shell refuses the verb at send. The real lock lands here as an endpoint
 * and a verb once one sandbox run cites it; nothing else moves.
 */

import type { OperationTransport } from "./transport.js";

/** The lockIssue operation's endpoints and verbs, both empty today. */
export const LOCK_ISSUE = {
    endpoints: [],
    verbs: () => ({}),
} satisfies OperationTransport;
