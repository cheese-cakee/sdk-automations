/**
 * prQuality — the seed, promoted in place against `design.md`.
 *
 * Reads a pull request, asks one resolver, writes at most one managed
 * comment. One of the design's five checks is built. Scope: `README.md`.
 */

import {
    declareCapability,
    intentFactoryFor,
    isOpen,
    skipped,
    type Capability,
} from "@hiero-hackers/automation-core";
import { PR_QUALITY_SETTINGS } from "./settings.js";

export const prQualityDeclaration = declareCapability({
    name: "prQuality",
    triggers: [{ kind: "event", event: "pull_request" }],
    settings: PR_QUALITY_SETTINGS,
    requiredMappings: {},
    facts: ["pullRequest"],
    needs: [],
    resolvers: ["linkedIssues"],
    intents: ["postManagedComment"],
    operationalNeeds: {
        schedule: false,
        durableState: "none",
        crossItemCoordination: false,
        externalDelivery: false,
    },
});

export type PrQualityDeclaration = typeof prQualityDeclaration;

/** The linked-issue check's row of the dashboard, when the check fails. */
const NO_LINKED_ISSUE =
    "This pull request does not reference an issue. Adding a closing reference keeps the issue and the pull request in step.";

/**
 * The guide sentence a failing check ends with, or nothing. The maintainer's
 * own text, so it is not put through `inert`.
 */
function guideSentence(guide: string | null): string {
    return guide === null ? "" : ` See the guide: ${guide}`;
}

export const prQuality: Capability<PrQualityDeclaration> = {
    declaration: prQualityDeclaration,

    async evaluate(facts, config, platform) {
        /** Closure is carried on both projection branches (D59). */
        if (!isOpen(facts)) return [];

        /**
         * A check runs only where a repository wrote `enabled: true` under it.
         * Above the resolver, so a check that is off asks nothing.
         */
        const linkedIssues = config.settings.checks.linkedIssues;
        if (!linkedIssues.enabled) return [];

        /**
         * "Unknown is not an answer" as behaviour: an undetermined answer is
         * not "no linked issue" (D51).
         */
        const linked = await platform.resolve("linkedIssues", { item: facts.item });
        if (!linked.ok) {
            return skipped(
                platform,
                "prQuality",
                "Skipped: the linked-issue resolver could not answer.",
                `resolver reason: ${linked.reason}`,
                linked.detail,
            );
        }
        if (linked.value.length > 0) return [];

        const make = intentFactoryFor(prQualityDeclaration, {
            repository: facts.repository,
            item: facts.item,
            observedAt: facts.observedAt,
        });
        return [
            make({
                operation: "postManagedComment",
                desired: {
                    kind: "summary",
                    body: `${NO_LINKED_ISSUE}${guideSentence(linkedIssues.guide)}`,
                },
                cause: "pullRequestWithoutLinkedIssue",
                claims: { closed: false },
                explain: {
                    summary: "No linked issue found on this pull request.",
                    detail: ["checked via the linkedIssues resolver"],
                },
            }),
        ];
    },
};
