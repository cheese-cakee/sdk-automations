/**
 * What inactivity declares it may receive, ask and do, and the two record
 * shapes that declaration earns it.
 *
 * Its own file because it is the folder's root: the ladders and the context
 * they take are typed against this declaration, and `capability.ts` imports
 * the ladders — so the declaration has to sit below all of them. It is
 * re-exported from `capability.ts`, which is where the package's registry and
 * the spec name it.
 */

import { declareCapability, type FactsFor } from "@hiero-hackers/automation-core";

export const inactivityDeclaration = declareCapability({
    name: "inactivity",
    triggers: [{ kind: "schedule", description: "daily stale-assignment sweep" }],
    configKeys: ["exemptBlocked", "remindAfterDays", "reapAfterDays", "issues", "pullRequests"],
    /**
     * Empty on purpose. The two label-based rules — reaping on `needsRevision`,
     * exempting `blocked` — demand their mappings only where a repository turns
     * them on, which is a guard (`unusableMappings`) rather than a static
     * requirement that would refuse the whole file.
     */
    requiredMappings: {},
    facts: ["issue", "pullRequest"],
    /**
     * Every group, because both ladders judge clocks. A producer that read only
     * the projection — a webhook — is a `factsUnread` skip, which is the point:
     * an assignee list nobody read is not an empty one.
     *
     * `needs` is per declaration, not per kind, so `links` is here for the
     * ISSUE side: `openPullRequests` is what silences the issue ladder. A pull
     * request's `links.issues` is read by nothing in this capability — the
     * close names only its own item, and a linked issue's assignees are the
     * issue ladder's on its next sweep — but the group stays, because the
     * design asks the sweep for it and the sweep reads it.
     *
     * `readiness` is `draft` alone, which left `review` when the study found
     * that a webhook can read it and the other three review facts need the
     * timeline. Both are needed here: the draft ladder reads the first and the
     * changes-requested ladder the second.
     *
     * No `reminder` group: the platform records its own warning and answers
     * the destructive door from that record, so there is nothing here to read
     * one back with (grace.md §2).
     */
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

/** The issue ladder's record. */
export type IssueLadderFacts = Extract<InactivityFacts, { kind: "issue" }>;

/** The pull-request ladder's record. */
export type PullLadderFacts = Extract<InactivityFacts, { kind: "pullRequest" }>;
