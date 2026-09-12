/** The release-assignment operation's transport: no endpoints, no verbs. */

import type { OperationTransport } from "./transport.js";

export const RELEASE_ASSIGNMENT = {
    endpoints: [],
    verbs: () => ({}),
} satisfies OperationTransport;
