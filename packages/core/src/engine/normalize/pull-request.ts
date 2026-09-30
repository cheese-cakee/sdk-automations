/**
 * The pull-request family: what a `pull_request` delivery becomes once the
 * shared preamble has read it. `readiness` is the one group the payload
 * carries whole; every other is `UNREAD`, never invented.
 */

import { deliveredGroups, type ProducedFacts } from "../../capability/index.js";
import { projectPullRequest, type ClosureReason } from "../../workflow/index.js";
import type { DeliveryFacts } from "./payload.js";
import { malformed, type NormalizeResult } from "./verdict.js";

/** Pull-request closure: `merged` is authoritative (D47 keeps them distinct). */
function prClosure(item: Record<string, unknown>): ClosureReason | null {
    if (item["merged"] === true) return "merged";
    return item["state"] === "closed" ? "closedByHuman" : null;
}

/** The `pull_request` entry of the registry. */
export const pullRequestNormalizer = {
    event: "pull_request",
    itemKey: "pull_request",
    normalize(facts: DeliveryFacts): NormalizeResult {
        if (typeof facts.item["merged"] !== "boolean") {
            return malformed("mergedMissing", "pull_request: merged missing");
        }
        // `readiness` is refused, never defaulted to `false`, when the payload lacks `draft`.
        const delivered = deliveredGroups("pull_request", "pullRequest", facts);
        if (!delivered.ok) return malformed(delivered.code, delivered.detail);
        return {
            kind: "facts",
            facts: {
                kind: "pullRequest",
                repository: facts.repository,
                item: { kind: "pullRequest", number: facts.number },
                observedAt: facts.observedAt,
                trigger: {
                    kind: "event",
                    event: "pull_request",
                    ...(facts.deliveryId === undefined ? {} : { deliveryId: facts.deliveryId }),
                },
                author: facts.author,
                actor: facts.actor,
                position: projectPullRequest({
                    closedBy: prClosure(facts.item),
                    meanings: facts.meanings,
                }),
                ...delivered.groups,
            } satisfies ProducedFacts<"pull_request", "pullRequest">,
        };
    },
} as const;
