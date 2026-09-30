/**
 * The issue family: what an `issues` delivery becomes once the shared preamble
 * has read it. A group the webhook cannot see is `UNREAD`, never invented.
 */

import { deliveredGroups, type ProducedFacts } from "../../capability/index.js";
import { projectIssue, type ClosureReason } from "../../workflow/index.js";
import type { DeliveryFacts } from "./payload.js";
import { malformed, type NormalizeResult } from "./verdict.js";

/**
 * Closure from what the webhook alone can see: `completedByLinkedMerge` (D47)
 * is not on this payload, so a closed issue reads `closedByHuman`.
 */
function issueClosure(item: Record<string, unknown>): ClosureReason | null {
    return item["state"] === "closed" ? "closedByHuman" : null;
}

/** The `issues` entry of the registry. */
export const issuesNormalizer = {
    event: "issues",
    itemKey: "issue",
    normalize(facts: DeliveryFacts): NormalizeResult {
        const delivered = deliveredGroups("issues", "issue", facts);
        if (!delivered.ok) return malformed(delivered.code, delivered.detail);
        return {
            kind: "facts",
            facts: {
                kind: "issue",
                repository: facts.repository,
                item: { kind: "issue", number: facts.number },
                observedAt: facts.observedAt,
                trigger: {
                    kind: "event",
                    event: "issues",
                    ...(facts.deliveryId === undefined ? {} : { deliveryId: facts.deliveryId }),
                },
                author: facts.author,
                actor: facts.actor,
                arrival:
                    facts.action === "opened"
                        ? { kind: "opened" }
                        : facts.action === "labeled"
                          ? {
                                kind: "label",
                                change: "added",
                                meaning: facts.arrivedMeaning,
                                skill: facts.arrivedSkill,
                            }
                          : facts.action === "unlabeled"
                            ? {
                                  kind: "label",
                                  change: "removed",
                                  meaning: facts.removedMeaning,
                                  skill: facts.removedSkill,
                              }
                            : null,
                position: projectIssue({
                    closedBy: issueClosure(facts.item),
                    meanings: facts.meanings,
                }),
                ...delivered.groups,
            } satisfies ProducedFacts<"issues", "issue">,
        };
    },
} as const;
