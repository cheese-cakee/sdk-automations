/** The lockIssue operation's transport: no endpoints, no verbs. */

import type { OperationTransport } from "./transport.js";

export const LOCK_ISSUE = {
    endpoints: [],
    verbs: () => ({}),
} satisfies OperationTransport;
