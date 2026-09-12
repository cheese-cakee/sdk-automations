/** The unlockIssue operation's transport: no endpoints, no verbs. */

import type { OperationTransport } from "./transport.js";

export const UNLOCK_ISSUE = {
    endpoints: [],
    verbs: () => ({}),
} satisfies OperationTransport;
