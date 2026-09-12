/** The close-pull-request operation's transport: no endpoints, no verbs. */

import type { OperationTransport } from "./transport.js";

export const CLOSE_PULL_REQUEST = {
    endpoints: [],
    verbs: () => ({}),
} satisfies OperationTransport;
