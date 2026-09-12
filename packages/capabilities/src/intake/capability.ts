/**
 * intake — the seed, promoted in place against `design.md`.
 *
 * The only capability that reads `view.mapped`, and the only one that emits
 * two intents from one record. Scope: `capabilities/README.md`.
 */

import {
    declareCapability,
    intentFactoryFor,
    isOpen,
    skipped,
    type Capability,
    type IntentFor,
} from "@hiero-hackers/automation-core";
import { INTAKE_SETTINGS } from "./settings.js";

export const intakeDeclaration = declareCapability({
    name: "intake",
    triggers: [{ kind: "event", event: "issues" }],
    settings: INTAKE_SETTINGS,
    requiredMappings: { labels: ["awaitingTriage"] },
    facts: ["issue"],
    needs: [],
    resolvers: ["isAutomationActor"],
    intents: ["applyMappedLabel", "postManagedComment"],
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

    async evaluate(facts, config, platform) {
        /**
         * The front door is for people. The author rather than the actor, and
         * an unanswered lookup is not a person (D51).
         */
        const openedByBot = await platform.resolve("isAutomationActor", {
            login: facts.author,
        });
        if (!openedByBot.ok) {
            return skipped(
                platform,
                "intake",
                "Skipped: nobody could say whether this issue was opened by an automation.",
                `the actor lookup answered ${openedByBot.reason}`,
            );
        }
        if (openedByBot.value) return [];

        /** A conflicted item has no position to reason from, and D35 forbids repair. */
        if (facts.position.kind === "conflict") {
            return skipped(
                platform,
                "intake",
                "Skipped: the item holds more than one workflow position.",
                `conflicting: ${facts.position.positions.join(", ")}`,
                "a conflict is reported, never repaired (D35)",
            );
        }

        /** A closed issue has already left the entry gate. Nothing to say about it. */
        if (!isOpen(facts)) return [];

        /**
         * A capability may only use a meaning the repository has mapped
         * (contract.md §2). D84 makes this unreachable through the parser.
         */
        if (!config.mapped.labels.includes("awaitingTriage")) {
            return skipped(
                platform,
                "intake",
                "Skipped: this repository has not mapped awaitingTriage.",
                "intake cannot triage without a mapped triage meaning",
            );
        }

        // Already positioned somewhere — intake is the entry gate only.
        if (facts.position.state.meaning !== null) return [];

        const intents: IntentFor<IntakeDeclaration>[] = [];
        /** D92 3d: the factory binds the occasion once. */
        const make = intentFactoryFor(intakeDeclaration, {
            repository: facts.repository,
            item: facts.item,
            observedAt: facts.observedAt,
        });

        intents.push(
            make({
                operation: "applyMappedLabel",
                /** The map's answer: `[*] → awaitingTriage` for `intakeObserved` (D78). */
                desired: { meaning: "awaitingTriage", cause: "intakeObserved" },
                cause: "issueWithoutPosition",
                claims: { meaningsAbsent: ["awaitingTriage"], closed: false },
                explain: {
                    summary: "New issue placed in triage.",
                    detail: ["the issue carried no mapped workflow meaning"],
                },
            }),
        );

        if (config.settings.announce) {
            intents.push(
                make({
                    operation: "postManagedComment",
                    desired: {
                        kind: "notice",
                        body: "Thanks for opening this. It has been placed in the triage queue.",
                    },
                    cause: "issueWithoutPosition",
                    // Only closure is claimed; the sibling intent applies the label first.
                    claims: { closed: false },
                    explain: {
                        summary: "Announced the triage placement.",
                        detail: ["announce is enabled for this repository"],
                    },
                }),
            );
        }

        return intents;
    },
};
