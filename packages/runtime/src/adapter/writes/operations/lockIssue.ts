/** The lockIssue operation's transport: no verbs; no endpoint is confirmed. */

import type { OperationTransport } from "./transport.js";

export const LOCK_ISSUE = {
    verbs: () => ({}),
} satisfies OperationTransport;
