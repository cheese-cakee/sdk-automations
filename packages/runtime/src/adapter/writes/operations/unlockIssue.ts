/** The unlockIssue operation's transport: no verbs; no endpoint is confirmed. */

import type { OperationTransport } from "./transport.js";

export const UNLOCK_ISSUE = {
    verbs: () => ({}),
} satisfies OperationTransport;
