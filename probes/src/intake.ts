/**
 * PROBE — mapping-consuming, label-writing, multi-intent, no resolvers.
 *
 * The only probe that consumes `mappedMeanings`, the only one that emits
 * two intents from one observation, and the only one whose resolver list
 * is empty — so it is also the test that an undeclared resolver is
 * unreachable rather than merely undocumented.
 *
 * Not a scope decision. See `probes/README.md`.
 */

import {
    closureOf,
    declareCapability,
    deriveIdempotencyKey,
    type Capability,
    type Intent,
    type IntentFor,
} from "@hiero-hackers/automation-core";

export const intakeDeclaration = declareCapability({
    name: "intake",
    triggers: [{ kind: "event", event: "issues" }],
    configKeys: ["announce"],
    observations: ["issueUpdated"],
    resolvers: [],
    intents: [
        {
            name: "applyMappedLabel",
            idempotencyClass: "idempotent",
            requiredPermissions: ["issues:write"],
        },
        {
            name: "postManagedComment",
            idempotencyClass: "nonIdempotent",
            requiredPermissions: ["issues:write"],
        },
    ],
    permissions: {
        repository: ["issues:write", "contents:read"],
        organization: [],
    },
    operationalNeeds: {
        schedule: false,
        durableState: "none",
        crossItemCoordination: false,
        externalDelivery: false,
    },
});

export type IntakeDeclaration = typeof intakeDeclaration;

export const intake: Capability<IntakeDeclaration> = {
    declaration: intakeDeclaration,

    async evaluate(observation, config, platform) {
        /**
         * A conflicted item has no position to reason from, and D35 forbids
         * repairing one. Before D81 this case was invisible — the payload
         * carried a bare meaning list, so an issue a human had put in two
         * positions looked like an ordinary one and intake would have acted.
         */
        if (observation.position.kind === "conflict") {
            platform.explain({
                capability: "intake",
                summary: "Skipped: the item holds more than one workflow position.",
                detail: [
                    `conflicting: ${observation.position.positions.join(", ")}`,
                    "a conflict is reported, never repaired (D35)",
                ],
            });
            return [];
        }
        if (closureOf(observation.position) !== null) return [];
        const { state } = observation.position;

        /**
         * A capability may only use a meaning the repository has mapped
         * (contract.md §6). It learns that the meaning is AVAILABLE and
         * never what the repository calls it — the label string is the
         * adapter's business.
         */
        if (!config.mappedMeanings.includes("awaitingTriage")) {
            platform.explain({
                capability: "intake",
                summary: "Skipped: this repository has not mapped awaitingTriage.",
                detail: ["intake cannot triage without a mapped triage meaning"],
            });
            return [];
        }
        // Already positioned somewhere — intake is the entry gate only.
        if (state.meaning !== null) return [];

        const intents: IntentFor<IntakeDeclaration>[] = [];

        const label = {
            capability: "intake",
            repository: observation.repository,
            item: observation.item,
            operation: "applyMappedLabel",
            actionClass: "reversibleStateChange",
            expected: {
                meaningsPresent: [],
                meaningsAbsent: ["awaitingTriage"],
                closed: false,
            },
            /**
             * The map's answer: `[*] → awaitingTriage` for `intakeObserved`.
             * This probe's own invented cause, `issueWithoutPosition`, is not
             * on the map — closing the type is what forced the question, and
             * the profile happened to have an edge for it (D78).
             */
            desired: { meaning: "awaitingTriage", cause: "intakeObserved" },
            cause: { cause: "issueWithoutPosition", observedAt: observation.observedAt },
            explanation: {
                capability: "intake",
                summary: "New issue placed in triage.",
                detail: ["the issue carried no mapped workflow meaning"],
            },
        } as const satisfies Omit<Intent<"applyMappedLabel">, "idempotencyKey">;

        intents.push({ ...label, idempotencyKey: deriveIdempotencyKey(label) });

        if (config.settings.announce === true) {
            const comment = {
                capability: "intake",
                repository: observation.repository,
                item: observation.item,
                operation: "postManagedComment",
                actionClass: "humanFacingOutput",
                expected: {
                    meaningsPresent: [],
                    meaningsAbsent: ["awaitingTriage"],
                    closed: false,
                },
                desired: {
                    marker: "<!-- hiero-automation:intake -->",
                    body: "Thanks for opening this. It has been placed in the triage queue.",
                },
                cause: {
                    cause: "issueWithoutPosition",
                    observedAt: observation.observedAt,
                },
                explanation: {
                    capability: "intake",
                    summary: "Announced the triage placement.",
                    detail: ["announce is enabled for this repository"],
                },
            } as const satisfies Omit<Intent<"postManagedComment">, "idempotencyKey">;

            intents.push({
                ...comment,
                idempotencyKey: deriveIdempotencyKey(comment),
            });
        }

        return intents;
    },
};
