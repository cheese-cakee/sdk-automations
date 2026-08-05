/**
 * PROBE — comment-only, event-triggered, non-idempotent, resolver-using.
 *
 * The narrowest shape in the triad: reads a pull request, asks one
 * resolver, writes at most one managed comment, needs no durable state
 * and no mapped meanings. It exists to prove the boundary works for a
 * capability that touches almost nothing.
 *
 * Not a scope decision. See `probes/README.md`.
 */

import {
    declareCapability,
    deriveIdempotencyKey,
    type Capability,
    type Intent,
    type IntentFor,
} from "@hiero-hackers/automation-core";

export const prQualityDeclaration = declareCapability({
    name: "prQuality",
    triggers: [{ kind: "event", event: "pull_request" }],
    configKeys: ["marker"],
    observations: ["pullRequestUpdated"],
    resolvers: ["linkedIssues"],
    intents: [
        {
            name: "postManagedComment",
            idempotencyClass: "nonIdempotent",
            requiredPermissions: ["issues:write"],
        },
    ],
    permissions: {
        repository: ["issues:write", "pull_requests:write", "contents:read"],
        organization: [],
    },
    operationalNeeds: {
        schedule: false,
        durableState: "none",
        crossItemCoordination: false,
        externalDelivery: false,
    },
});

export type PrQualityDeclaration = typeof prQualityDeclaration;

const DEFAULT_MARKER = "<!-- hiero-automation:prQuality -->";

export const prQuality: Capability<PrQualityDeclaration> = {
    declaration: prQualityDeclaration,

    async evaluate(observation, config, platform) {
        if (observation.closed || observation.merged) return [];

        const linked = await platform.resolve("linkedIssues", {
            item: observation.item,
        });
        /**
         * resolvers.md §6 as behaviour rather than a promise: an
         * undetermined answer is NOT "no linked issue". Without the
         * `ResolverAnswer` union this capability would have read a
         * rate-limit failure as a quality problem and told a contributor
         * to link an issue they had already linked.
         */
        if (!linked.ok) {
            platform.explain({
                capability: "prQuality",
                summary: "Skipped: the linked-issue resolver could not answer.",
                detail: [`resolver reason: ${linked.reason}`, linked.detail],
            });
            return [];
        }
        if (linked.value.length > 0) return [];

        const marker =
            typeof config.settings.marker === "string"
                ? config.settings.marker
                : DEFAULT_MARKER;

        const draft = {
            capability: "prQuality",
            repository: observation.repository,
            item: observation.item,
            operation: "postManagedComment",
            actionClass: "humanFacingOutput",
            expected: { meaningsPresent: [], meaningsAbsent: [], closed: false },
            desired: {
                marker,
                body: "This pull request does not reference an issue. Adding a closing reference keeps the issue and the pull request in step.",
            },
            cause: {
                cause: "pullRequestWithoutLinkedIssue",
                observedAt: observation.observedAt,
            },
            explanation: {
                capability: "prQuality",
                summary: "No linked issue found on this pull request.",
                detail: ["checked via the linkedIssues resolver"],
            },
        } as const satisfies Omit<Intent<"postManagedComment">, "idempotencyKey">;

        return [
            {
                ...draft,
                idempotencyKey: deriveIdempotencyKey(draft),
            } satisfies IntentFor<PrQualityDeclaration>,
        ];
    },
};
