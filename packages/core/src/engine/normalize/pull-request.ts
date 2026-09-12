/**
 * The pull-request family: what a `pull_request` delivery becomes once the
 * shared preamble has read it.
 *
 * One family, one module, one registry entry — `../events.ts` names this one
 * under `pull_request` and hands it `DeliveryFacts`. It is the family that
 * can still refuse: `merged` is the one field no other family reads and the
 * preamble therefore never checked.
 *
 * A webhook reads the projection and the one group the payload carries whole —
 * `readiness`. Everything else is marked `UNREAD`, `review` included, which is
 * why `inactivity` is skipped on a delivery rather than judging a clock from
 * facts nobody read. The `satisfies` below is that promise as a constraint: the
 * `pull_request` row of `PRODUCERS` names `readiness` and nothing else, so
 * filling any other group here does not compile.
 */

import { UNREAD, type ProducedFacts } from "../../capability/index.js";
import { projectPullRequest, type ClosureReason } from "../../workflow/index.js";
import type { DeliveryFacts } from "./payload.js";
import { malformed, type NormalizeResult } from "./verdict.js";

/**
 * The one readiness fact a delivery carries. Refused rather than defaulted:
 * `draft: false` invented for a payload that did not say would be the lie
 * facts.md §2 exists to forbid, and it is the lie that posts "ready for
 * review" on a draft.
 */
function draftState(item: Record<string, unknown>): boolean | null {
    return typeof item["draft"] === "boolean" ? item["draft"] : null;
}

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
        const draft = draftState(facts.item);
        if (draft === null) {
            return malformed("draftMissing", "pull_request: draft missing");
        }
        return {
            kind: "facts",
            facts: {
                kind: "pullRequest",
                repository: facts.repository,
                item: { kind: "pullRequest", number: facts.number },
                observedAt: facts.observedAt,
                trigger: { kind: "event", event: "pull_request" },
                author: facts.author,
                actor: facts.actor,
                alerts: facts.alerts,
                position: projectPullRequest({
                    closedBy: prClosure(facts.item),
                    meanings: facts.meanings,
                }),
                assignees: UNREAD,
                links: UNREAD,
                review: UNREAD,
                readiness: { draft },
            } satisfies ProducedFacts<"pull_request", "pullRequest">,
        };
    },
} as const;
