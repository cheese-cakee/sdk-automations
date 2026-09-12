/**
 * What GitHub's answer to a write MEANS, and the seam every verb sends through.
 *
 * `http.ts` decides whether a write may be SENT — the origin pin, the
 * per-endpoint allowlist, the grant, the retry budget. This file decides what
 * came back, in the endpoint matrix's vocabulary: `applied`, `already`,
 * `conflict`, `forbidden`, `retryLater`, `unknown`. A capability acts on the
 * word and never on a status code.
 *
 * One rule shapes every ambiguous mapping. `unknown` means "sent, and nothing
 * here can tell whether it landed", and the matrix forbids a caller from
 * retrying it. So a class becomes `unknown` only when the write may genuinely
 * have applied, and becomes `retryLater` whenever re-sending is provably
 * harmless — which for an idempotent verb includes the ambiguous classes,
 * because applying a no-op twice is applying it once.
 *
 * The URLs are built in `operations/`, each beside the shape the gate matches
 * it with. They stay two spellings — a gate that trusted a builder would not
 * be a gate (D129) — and the review that keeps them honest is now one screen
 * rather than two files.
 */

import type { RepositoryRef } from "@hiero-hackers/automation-core";
import {
    describeFailure,
    type GitHubHttpClient,
    type GitHubHttpFailureClass,
    type GitHubWriteRequest,
    type WriteIdempotency,
} from "./contract.js";
import { writeVerbsOf } from "./operations/index.js";
import type { NotFoundMeaning, WriteResult, WriteVerbs } from "./operations/transport.js";

// ─── Reading GitHub's answer ─────────────────────────────────────────

/**
 * The one place this file reads GitHub's prose, and it is DOCUMENTED rather
 * than probed: no run in the endpoint matrix removed an absent label, so this
 * pattern has no dated citation and no `probedAt`. It degrades the way core's
 * `BODY_PATTERNS` do — a reworded message stops matching and the result falls
 * back to `forbidden`, which is wrong in the harmless direction.
 */
export const LABEL_ABSENT = {
    pattern: /label does not exist/i,
    documented: "Label does not exist",
} as const;

const conflict = (detail: string): WriteResult => ({ outcome: "conflict", detail });
const forbidden = (detail: string): WriteResult => ({ outcome: "forbidden", detail });
const retryLater = (detail: string): WriteResult => ({ outcome: "retryLater", detail });

/**
 * A failure that may or may not have landed, answered by idempotency.
 *
 * A timeout and a dropped socket both arrive as `transient`, and both can mean
 * GitHub applied the change and lost the answer on the way back. Re-sending an
 * idempotent write in that state costs nothing, so it is `retryLater`. For the
 * comment create it is `unknown`, and the caller reconciles instead.
 */
function ambiguous(idempotency: WriteIdempotency, detail: string): WriteResult {
    return idempotency === "idempotent"
        ? retryLater(`${detail}; re-sending this write cannot apply it twice`)
        : { outcome: "unknown", detail: `${detail}; the write may already have landed` };
}

/**
 * One failed write as one word, per class and per endpoint.
 *
 * The rate classes are `retryLater` with GitHub's own wait signal in the
 * detail, the same shape the read path gives an operator. `tokenExpired` joins
 * them because a 401 provably applied nothing and the client has already
 * dropped the token, so the next call mints a fresh one. `validationError`,
 * `clientError` and `redirected` are `conflict`: a 4xx never mutates, and each
 * says the world is not the shape the plan named. Everything else that denies
 * or refuses is `forbidden`, including a local refusal — nothing was sent, so
 * calling it `unknown` would send the caller reconciling a change that does
 * not exist.
 */
function resultOfFailure(
    failure: GitHubHttpFailureClass,
    idempotency: WriteIdempotency,
    notFound: NotFoundMeaning,
    body: string,
): WriteResult {
    switch (failure.kind) {
        case "notSent":
            return forbidden(`the adapter refused the write: ${describeFailure(failure)}`);
        case "responseTooLarge":
        case "transient":
            return ambiguous(idempotency, `GitHub call failed: ${describeFailure(failure)}`);
        case "tokenExpired":
            return retryLater("the installation token had expired and has been dropped");
        case "primaryExhausted":
            return retryLater(
                "GitHub primary rate limit reached; the budget resets at " +
                    (failure.resetAt ?? "an instant GitHub did not report"),
            );
        case "secondaryLimit":
            return retryLater(
                failure.retryAfterSeconds === undefined
                    ? "GitHub secondary rate limit reached, with no retry-after to wait on"
                    : `GitHub secondary rate limit reached; retry-after ${String(failure.retryAfterSeconds)}s`,
            );
        case "rateLimitResponseUnusable":
            return retryLater(
                `GitHub rate limit reached; ${failure.headerName} ` +
                    `"${failure.headerValue}" is ${failure.reason}`,
            );
        case "notFoundOrNotInstalled":
            if (notFound === "labelMayBeAbsent" && LABEL_ABSENT.pattern.test(body)) {
                return { outcome: "already" };
            }
            return forbidden(
                "GitHub answered 404: the item is absent or outside the installation, " +
                    "and the two cannot be told apart",
            );
        case "permissionMissing":
            return forbidden(`GitHub wants the permission ${failure.acceptedPermissions}`);
        case "installationSuspended":
            return forbidden("the App installation is suspended");
        case "forbiddenUnrecognized":
            return forbidden(`GitHub denied the write: ${failure.bodySnippet}`);
        case "badCredentials":
            return forbidden("GitHub rejected the App's credentials");
        case "validationError":
            return conflict("GitHub refused the write as invalid against the item's current state");
        case "redirected":
            return conflict(
                `GitHub redirected the write to ${failure.location ?? "an undisclosed location"}`,
            );
        case "clientError":
            return conflict(`GitHub refused the write with ${String(failure.status)}`);
    }
}

// ─── The verbs ───────────────────────────────────────────────────────

export interface WriteVerbsOptions {
    readonly http: GitHubHttpClient;
    readonly repository: RepositoryRef;
}

/**
 * The write surface one repository's capabilities share: every operation's
 * verbs, over the one send-and-classify mechanism.
 */
export function createWriteVerbs({ http, repository }: WriteVerbsOptions): WriteVerbs {
    /** Send one write and name its answer; every verb ends here. */
    const apply = async (
        request: GitHubWriteRequest,
        notFound: NotFoundMeaning,
    ): Promise<WriteResult> => {
        const outcome = await http.request(request);
        if (outcome.ok) return { outcome: "applied" };
        // A failure carries no body when no response arrived, and an absent
        // body cannot name a label — the empty string reads the same way.
        return resultOfFailure(outcome.failure, request.idempotency, notFound, outcome.body ?? "");
    };

    return writeVerbsOf({ repository, apply });
}
