/**
 * The release-assignment operation's transport: no endpoints, no verbs.
 *
 * The same registered refusal `unassign.ts` is, and for the same reason — the
 * assignee write family is one confirmed endpoint away, and until it lands the
 * shell refuses the verb at send rather than discovering the gap here.
 */

import type { OperationTransport } from "./transport.js";

/** The release-assignment operation's endpoints and verbs, both empty today. */
export const RELEASE_ASSIGNMENT = {
    endpoints: [],
    verbs: () => ({}),
} satisfies OperationTransport;
