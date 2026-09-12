/** The unassign operation's transport: no endpoints, no verbs. */

import type { OperationTransport } from "./transport.js";

export const UNASSIGN = {
    endpoints: [],
    verbs: () => ({}),
} satisfies OperationTransport;
