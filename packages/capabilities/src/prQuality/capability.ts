/**
 * prQuality — the seed, promoted in place against `design.md`.
 *
 * The narrowest shape in the triad: reads a pull request, asks one
 * resolver, writes at most one managed comment, needs no durable state,
 * no mapped meanings and — since D125 took the marker off it — no
 * settings either. It exists to prove the boundary works for a
 * capability that touches almost nothing, so it takes no view at all.
 *
 * Not a scope decision. See `capabilities/README.md`.
 */

import {
    declareCapability,
    intentFactoryFor,
    isOpen,
    skipped,
    type Capability,
} from "@hiero-hackers/automation-core";

export const prQualityDeclaration = declareCapability({
    name: "prQuality",
    triggers: [{ kind: "event", event: "pull_request" }],
    configKeys: [],
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

export const prQuality: Capability<PrQualityDeclaration> = {
    declaration: prQualityDeclaration,

    async evaluate(facts, _config, platform) {
        /**
         * Closure is carried on BOTH projection branches (D59), and reading it
         * only from the position branch would have asked for a comment on a
         * merged pull request whose labels happened to conflict.
         *
         * A conflict is not a guard here, because this capability reads no
         * position. It does not follow that a conflicted pull request gets a
         * comment: `deriveWorld` establishes no precondition from a conflicted
         * projection, so the engine refuses every intent on one with
         * `preconditionStale`.
         */
        if (!isOpen(facts)) return [];

        /**
         * The resolver question, and the catalogue's "unknown is not an answer"
         * (`design/contracts/catalogue.md`) as behaviour rather than a promise:
         * an undetermined answer is NOT "no linked issue". Without the
         * `ResolverAnswer` union this capability would have read a rate-limit
         * failure as a quality problem and told a contributor to link an issue
         * they had already linked.
         *
         * The answer is not carried past this guard, so the resolver is asked
         * once and nothing has to be stashed for the act: reaching the comment
         * already MEANS the list came back empty, and the comment says nothing
         * about what was in it.
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
                    body: "This pull request does not reference an issue. Adding a closing reference keeps the issue and the pull request in step.",
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
