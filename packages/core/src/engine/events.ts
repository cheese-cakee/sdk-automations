/**
 * The normalizer — a raw webhook delivery becomes a fact record, or a typed
 * refusal to make one. The pipeline's first stage.
 *
 * This file is the registry walk, and nothing else. It owns the preamble every
 * family shares (payload object → repository → item → number → labels →
 * timestamp → author → meanings → alerts → sender) and the routing; the
 * vocabulary of events core consumes
 * is `WEBHOOK_PRODUCERS`, because an event IS a producer and a declared trigger
 * names one. Each family's own reading lives in a module of `normalize/`, and
 * `NORMALIZERS` is what makes the set complete: a webhook producer with no
 * module there does not compile.
 *
 * ADDING A FAMILY is three edits — one module in `normalize/` exporting the
 * payload key that carries the item and a `normalize(facts)`, one name and row
 * in `PRODUCERS`, one line in `NORMALIZERS` — and the compiler checks the
 * third, so a name with no module is a missing property rather than a delivery
 * that quietly answers `ignored` in production.
 *
 * Two traps for a family module. THE PREAMBLE IS NOT YOURS TO DUPLICATE: it is
 * read once here, in an order the malformed-code tests pin, and a module
 * receives `DeliveryFacts` and reads only the fields no other family reads.
 * And THE REFUSAL CODES ARE ONE CLOSED LIST (D75), in `normalize/verdict.ts`;
 * a family needing a new way to be unreadable adds a code there rather than
 * inventing a private vocabulary. Everything a capability may know about the
 * wire format dies in that directory, and the modules are built test-first
 * against REAL captured payloads (`packages/dev/testkit/fixtures/`, protocol
 * 7.1), never invented ones.
 *
 * Total, like everything at this boundary. A delivery this file does not
 * consume is `ignored` (normal — pushes, stars, pings); one it consumes
 * but cannot read is `malformed` (loud — GitHub changed shape, or the
 * shell handed us something that is not a webhook body). Nothing throws.
 *
 * The boundary with `github/` (D92 phase 5): what stays there is observed
 * knowledge ABOUT GitHub, while what a delivery BECOMES is the engine's
 * business.
 */

import { isWebhookProducer, type WebhookProducer } from "../capability/index.js";
import { alertsOfLabels, meaningsOfLabels, type RepositoryConfig } from "../config/index.js";
import { issueCommentNormalizer } from "./normalize/issue-comment.js";
import { issuesNormalizer } from "./normalize/issues.js";
import {
    authorLogin,
    isRecord,
    labelAdded,
    labelNames,
    repositoryOf,
    senderOf,
    timestamp,
    type DeliveryFacts,
} from "./normalize/payload.js";
import { pullRequestNormalizer } from "./normalize/pull-request.js";
import { malformed, type NormalizeResult } from "./normalize/verdict.js";

export {
    NORMALIZE_MALFORMED_CODES,
    type NormalizeMalformedCode,
    type NormalizeResult,
} from "./normalize/verdict.js";
export { repositoryNamedBy } from "./normalize/payload.js";

/** What one event family contributes to the walk below. */
interface EventNormalizer<E extends WebhookProducer> {
    readonly event: E;
    /** Which payload key carries the item (`issue` / `pull_request`). */
    readonly itemKey: string;
    normalize(facts: DeliveryFacts): NormalizeResult;
}

/**
 * The routing, and the completeness check in one declaration: the mapped type
 * demands an entry per webhook producer, so adding a name to `PRODUCERS`
 * without writing its module is a compile error here rather than a delivery
 * that silently answers `ignored` in production.
 */
const NORMALIZERS: { readonly [E in WebhookProducer]: EventNormalizer<E> } = {
    issues: issuesNormalizer,
    issue_comment: issueCommentNormalizer,
    pull_request: pullRequestNormalizer,
};

/**
 * Normalize one delivery. `event` is the `x-github-event` header; `payload`
 * is the parsed body; `config` supplies the label mapping this repository
 * reviewed — an unmapped label never survives into the record.
 */
export function normalizeDelivery(
    event: string,
    payload: unknown,
    config: RepositoryConfig,
): NormalizeResult {
    if (!isWebhookProducer(event)) {
        return { kind: "ignored", event };
    }
    const normalizer = NORMALIZERS[event];
    if (!isRecord(payload)) {
        return malformed("payloadNotObject", `${event}: payload is not an object`);
    }
    const repository = repositoryOf(payload);
    if (repository === null) {
        return malformed("repositoryUnreadable", `${event}: repository/owner missing`);
    }

    const itemKey = normalizer.itemKey;
    const item = payload[itemKey];
    if (!isRecord(item)) {
        return malformed("itemMissing", `${event}: "${itemKey}" missing`);
    }
    if (typeof item["number"] !== "number") {
        return malformed("numberMissing", `${event}: item number missing`);
    }
    const names = labelNames(item);
    if (names === null) {
        return malformed("labelsUnreadable", `${event}: labels unreadable`);
    }
    const observedAt = timestamp(item["updated_at"]);
    if (observedAt === null) {
        return malformed("timestampUnreadable", `${event}: updated_at unreadable`);
    }
    const author = authorLogin(item);
    if (author === null) {
        return malformed("authorUnreadable", `${event}: user.login unreadable`);
    }

    const meanings = meaningsOfLabels(config, names);
    // The added label is intersected with the item's own labels rather than
    // read alone: a `labeled` payload whose label is not on the item is one
    // disagreeing with itself, and the item's list is what the projection was
    // built from.
    const added = labelAdded(payload);
    const carried = alertsOfLabels(config, names);
    const arrived =
        added === null ? [] : alertsOfLabels(config, [added]).filter((a) => carried.includes(a));

    return normalizer.normalize({
        repository,
        item,
        number: item["number"],
        author,
        meanings,
        alerts: { carried, arrived },
        actor: senderOf(payload),
        observedAt,
        payload,
        config,
    });
}
