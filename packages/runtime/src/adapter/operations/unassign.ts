/**
 * The unassign operation's transport: no endpoints, no verbs.
 *
 * This is why the shell refuses the verb at send rather than discovering the
 * gap in the adapter — an operation the catalogue names and the write surface
 * cannot reach is a registered, refusing transport, not a missing file. The
 * real unassign lands here as an endpoint and a verb; nothing else moves.
 */

import type { OperationTransport } from "./transport.js";

/** The unassign operation's endpoints and verbs, both empty today. */
export const UNASSIGN = {
    endpoints: [],
    verbs: () => ({}),
} satisfies OperationTransport;
