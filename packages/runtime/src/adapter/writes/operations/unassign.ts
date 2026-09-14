/** The unassign operation's transport: no verbs; no endpoint is confirmed. */

import type { OperationTransport } from "./transport.js";

export const UNASSIGN = {
    verbs: () => ({}),
} satisfies OperationTransport;
