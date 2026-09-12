/** The assign operation's transport: no endpoints, no verbs. */

import type { OperationTransport } from "./transport.js";

export const ASSIGN = {
    endpoints: [],
    verbs: () => ({}),
} satisfies OperationTransport;
