/**
 * What inactivity declares it may receive, ask and do, and the two record
 * shapes that declaration earns it. The folder's root, below the ladders.
 */

import { declareCapability, type FactsFor } from "@hiero-hackers/automation-core";
import { INACTIVITY_SETTINGS } from "./settings.js";

export const inactivityDeclaration = declareCapability({
    name: "inactivity",
    triggers: [{ kind: "schedule", description: "hourly stale-assignment sweep" }],
    settings: INACTIVITY_SETTINGS,
    /** Empty on purpose: the label rules demand their mappings in a guard. */
    requiredMappings: {},
    facts: ["issue", "pullRequest"],
    /** Every group, because both ladders judge clocks. */
    needs: ["assignees", "links", "review", "readiness"],
    resolvers: ["isAutomationActor"],
    intents: ["postManagedComment", "releaseAssignment", "closePullRequest"],
    operationalNeeds: {
        schedule: true,
        durableState: "required",
        crossItemCoordination: false,
        externalDelivery: false,
    },
});

export type InactivityDeclaration = typeof inactivityDeclaration;

/** One record with every group read — what either ladder is handed. */
export type InactivityFacts = FactsFor<InactivityDeclaration>;

export type IssueLadderFacts = Extract<InactivityFacts, { kind: "issue" }>;

export type PullLadderFacts = Extract<InactivityFacts, { kind: "pullRequest" }>;
