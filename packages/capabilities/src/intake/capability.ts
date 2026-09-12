/**
 * intake — the seed, promoted in place against `design.md`.
 *
 * The only probe that consumes `view.mapped`, the only one that emits
 * two intents from one record, and the only one whose resolver list
 * is empty — so it is also the test that an undeclared resolver is
 * unreachable rather than merely undocumented.
 *
 * Not a scope decision. See `capabilities/README.md`.
 */

import {
    declareCapability,
    intentFactoryFor,
    isOpen,
    readSettings,
    skipped,
    unusable,
    type Capability,
    type IntentFor,
} from "@hiero-hackers/automation-core";
import { INTAKE_SETTINGS } from "./settings.js";

export const intakeDeclaration = declareCapability({
    name: "intake",
    triggers: [{ kind: "event", event: "issues" }],
    configKeys: ["announce"],
    requiredMappings: { labels: ["awaitingTriage"] },
    facts: ["issue"],
    needs: [],
    resolvers: [],
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
        const settings = readSettings(INTAKE_SETTINGS, config);
        if (!settings.ok) return unusable(settings.problems, platform, "intake");

        /**
         * A conflicted item has no position to reason from, and D35 forbids
         * repairing one. Before D81 this case was invisible — the payload
         * carried a bare meaning list, so an issue a human had put in two
         * positions looked like an ordinary one and intake would have acted.
         */
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
         * (contract.md §2). It learns that the meaning is AVAILABLE and
         * never what the repository calls it — the label string is the
         * adapter's business.
         *
         * Since D84 the parser refuses a file that enables intake without
         * mapping `awaitingTriage`, so a configuration the shell parsed can no
         * longer reach this skip. It stays because an observation may arrive
         * against a configuration the parser never saw — `NO_CONFIG`, a test
         * harness, any future caller — and a capability that assumed otherwise
         * would act on a meaning nobody mapped.
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
        /**
         * D92 3d: the factory binds the occasion once. The two intents
         * below were ~60 lines of hand-assembled record; every line that
         * survives is a decision, not plumbing.
         */
        const make = intentFactoryFor(intakeDeclaration, {
            repository: facts.repository,
            item: facts.item,
            observedAt: facts.observedAt,
        });

        intents.push(
            make({
                operation: "applyMappedLabel",
                /**
                 * The map's answer: `[*] → awaitingTriage` for
                 * `intakeObserved`. This probe's own invented cause,
                 * `issueWithoutPosition`, is not on the map — closing the
                 * type is what forced the question (D78).
                 */
                desired: { meaning: "awaitingTriage", cause: "intakeObserved" },
                cause: "issueWithoutPosition",
                claims: { meaningsAbsent: ["awaitingTriage"], closed: false },
                explain: {
                    summary: "New issue placed in triage.",
                    detail: ["the issue carried no mapped workflow meaning"],
                },
            }),
        );

        if (settings.value.announce) {
            intents.push(
                make({
                    operation: "postManagedComment",
                    desired: {
                        kind: "notice",
                        body: "Thanks for opening this. It has been placed in the triage queue.",
                    },
                    cause: "issueWithoutPosition",
                    // Only closure is claimed. The announce does not require
                    // the meaning absent — its own sibling intent puts the
                    // label there first, and an apply-time re-gate holding
                    // this comment to the label's absence would refuse the
                    // announcement OF the label it just applied (found in
                    // 8.2 pre-flight, 2026-09-02).
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
