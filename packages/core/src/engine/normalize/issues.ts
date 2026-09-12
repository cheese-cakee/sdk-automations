/**
 * The issue family: what an `issues` delivery becomes once the shared
 * preamble has read it.
 *
 * One family, one module, one registry entry — `../events.ts` names this
 * one under `issues` and hands it `DeliveryFacts`. It reads only the fields
 * no other family shares, and refuses nothing: an issue whose preamble
 * succeeded always has a record.
 *
 * A webhook reads the projection and nothing else, so every group is marked
 * `UNREAD` (contracts/facts.md §2). Marking rather than inventing is the whole
 * point: an empty assignee list here would be a lie the safety world could not
 * tell from a fact. The `satisfies` below is that promise as a constraint: the
 * `issues` row of `PRODUCERS` names no group, so filling one here does not
 * compile.
 */

import { UNREAD, type ProducedFacts } from "../../capability/index.js";
import { projectIssue, type ClosureReason } from "../../workflow/index.js";
import type { DeliveryFacts } from "./payload.js";
import type { NormalizeResult } from "./verdict.js";

/**
 * Issue closure, from what the webhook alone can see. GitHub reports
 * `state` and `state_reason`; whether a closure was CAUSED by a linked
 * merge (`completedByLinkedMerge`, D47) is not on this payload — it needs
 * the timeline API, which is the adapter's territory. Until then a closed
 * issue reads `closedByHuman`, the conservative reason: it never triggers
 * merge-gated policy (progression credits only merged pull requests).
 */
function issueClosure(item: Record<string, unknown>): ClosureReason | null {
    return item["state"] === "closed" ? "closedByHuman" : null;
}

/** The `issues` entry of the registry. */
export const issuesNormalizer = {
    event: "issues",
    itemKey: "issue",
    normalize(facts: DeliveryFacts): NormalizeResult {
        return {
            kind: "facts",
            facts: {
                kind: "issue",
                repository: facts.repository,
                item: { kind: "issue", number: facts.number },
                observedAt: facts.observedAt,
                trigger: { kind: "event", event: "issues" },
                author: facts.author,
                actor: facts.actor,
                alerts: facts.alerts,
                position: projectIssue({
                    closedBy: issueClosure(facts.item),
                    meanings: facts.meanings,
                }),
                assignees: UNREAD,
                links: UNREAD,
                command: UNREAD,
            } satisfies ProducedFacts<"issues", "issue">,
        };
    },
} as const;
