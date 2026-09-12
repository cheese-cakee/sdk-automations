/**
 * The close-pull-request operation's transport: no endpoints, no verbs.
 *
 * A pull-request write reaches a path this package has never admitted — the
 * gate's preamble knows `repos/{owner}/{repo}/issues` and nothing else — so
 * the endpoint arrives with its own matrix row, not as a shape bolted onto
 * that walk.
 */

import type { OperationTransport } from "./transport.js";

/** The close-pull-request operation's endpoints and verbs, both empty today. */
export const CLOSE_PULL_REQUEST = {
    endpoints: [],
    verbs: () => ({}),
} satisfies OperationTransport;
