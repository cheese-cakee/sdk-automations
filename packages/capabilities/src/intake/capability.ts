/**
 * intake — walk a new issue from its opening to triaged, ready work
 * (`design.md`): the label, and the announcement a repository may ask for.
 * The words are `messages.ts`.
 */

import {
    declareCapability,
    type Capability,
    type IntentFor,
} from "@hiero-hackers/automation-core/author";
import { TRIAGE_ANNOUNCED } from "./messages.js";
import { INTAKE_SETTINGS } from "./settings.js";

export const intakeDeclaration = declareCapability({
    name: "intake",
    triggers: [{ kind: "event", event: "issues" }],
    settings: INTAKE_SETTINGS,
    requiredMappings: { labels: ["awaitingTriage"] },
    labels: ["awaitingTriage"],
    resolvers: ["isAutomationActor"],
    intents: ["applyMappedLabel", "postManagedComment"],
});

export type IntakeDeclaration = typeof intakeDeclaration;

export const intake: Capability<IntakeDeclaration> = {
    declaration: intakeDeclaration,

    async evaluate(facts, config, platform) {
        // The front gate is for people: the author, not the actor.
        if (await platform.ask("isAutomationActor", { login: facts.author })) return [];

        // A conflicted item has no position to reason from, and D35 forbids repair.
        if (facts.position.kind === "conflict") {
            return platform.skip(
                "Skipped: the item holds more than one workflow position.",
                `conflicting: ${facts.position.positions.join(", ")}`,
                "a conflict is reported, never repaired (D35)",
            );
        }

        // Already positioned somewhere — intake is the entry gate only.
        if (facts.position.state.meaning !== null) return [];

        const intents: IntentFor<IntakeDeclaration>[] = [
            platform.intent({
                operation: "applyMappedLabel",
                desired: { meaning: "awaitingTriage" },
                cause: "issueWithoutPosition",
                explain: "Placed the new issue in triage.",
            }),
        ];

        if (config.settings.announce) {
            intents.push(
                platform.intent({
                    operation: "postManagedComment",
                    desired: { kind: "notice", body: TRIAGE_ANNOUNCED },
                    cause: "issueWithoutPosition",
                    explain: "Announced the triage placement.",
                }),
            );
        }

        return intents;
    },
};
