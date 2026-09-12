/**
 * The assign operation's transport: no endpoints, no verbs.
 *
 * `POST /repos/{o}/{r}/issues/{n}/assignees` is not a row in
 * `design/findings/endpoint-permission-matrix.md`, and a row without a
 * citation does not close the gate — so this is a registered, REFUSING
 * transport rather than a missing file, exactly as `unassign` is. The real
 * assign lands here as an endpoint and a verb once one sandbox protocol run
 * puts its row in the matrix; nothing else moves.
 */

import type { OperationTransport } from "./transport.js";

/** The assign operation's endpoints and verbs, both empty today. */
export const ASSIGN = {
    endpoints: [],
    verbs: () => ({}),
} satisfies OperationTransport;
