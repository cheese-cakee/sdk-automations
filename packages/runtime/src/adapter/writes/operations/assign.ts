/** The assign operation's transport: no verbs; no endpoint is confirmed. */

import type { OperationTransport } from "./transport.js";

export const ASSIGN = {
    verbs: () => ({}),
} satisfies OperationTransport;
