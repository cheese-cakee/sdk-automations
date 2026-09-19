/**
 * triageQueue — put a new issue in the triage queue: label it, welcome its author, hold it until triaged (`design.md`).
 * The lock lifts when someone with triage access adds the ready label. The words are `messages.ts`.
 */

import {
    declareCapability,
    type Capability,
    type CapabilityView,
    type IntentFor,
    type PlatformHandle,
} from "@hiero-hackers/automation-core/author";
import { unlocked, welcome } from "./messages.js";
import { TRIAGE_QUEUE_SETTINGS } from "./settings.js";

export const triageQueueDeclaration = declareCapability({
    name: "triageQueue",
    triggers: [{ kind: "event", event: "issues" }],
    settings: TRIAGE_QUEUE_SETTINGS,
    requiredMappings: { labels: ["awaitingTriage"] },
    labels: ["awaitingTriage"],
    resolvers: ["isAutomationActor"],
    intents: ["applyMappedLabel", "postManagedComment", "lockIssue", "unlockIssue"],
});

export type TriageQueueDeclaration = typeof triageQueueDeclaration;

type Facts = Parameters<Capability<TriageQueueDeclaration>["evaluate"]>[0];
type View = CapabilityView<TriageQueueDeclaration>;
type Platform = PlatformHandle<TriageQueueDeclaration>;
type Intents = readonly IntentFor<TriageQueueDeclaration>[];

/** The meaning whose arrival completes triage: the map's one edge out of `awaitingTriage`. */
const TRIAGED = "ready";

/** The entry gate: the label, the welcome, then the lock — last, so the author can read why. */
function onOpened(facts: Facts, config: View, platform: Platform): Intents {
    // A conflicted item has no position to reason from, and D35 forbids repair.
    if (facts.position.kind === "conflict") {
        return platform.skip(
            "Skipped: the item holds more than one workflow position.",
            `conflicting: ${facts.position.positions.join(", ")}`,
            "a conflict is reported, never repaired (D35)",
        );
    }
    // Already past the gate — triageQueue is the entry gate only. A template-applied triage label is still at it.
    const { meaning } = facts.position.state;
    if (meaning !== null && meaning !== "awaitingTriage") return [];

    const { welcome: welcomed, lockUntilTriaged } = config.settings;
    const intents: IntentFor<TriageQueueDeclaration>[] = [];
    if (meaning === null) {
        intents.push(
            platform.intent({
                operation: "applyMappedLabel",
                desired: { meaning: "awaitingTriage" },
                cause: "issueWithoutPosition",
                explain: "Placed the new issue in triage.",
            }),
        );
    }
    if (welcomed || lockUntilTriaged) {
        intents.push(
            platform.intent({
                operation: "postManagedComment",
                desired: {
                    kind: "notice",
                    topic: "welcome",
                    body: welcome(facts.author, lockUntilTriaged),
                },
                cause: "issueWithoutPosition",
                explain: "Welcomed the author and said the issue awaits triage.",
            }),
        );
    }
    if (lockUntilTriaged && !facts.locked) {
        intents.push(
            platform.intent({
                operation: "lockIssue",
                desired: { reason: "the issue is waiting for triage" },
                explain: "Locked the conversation until the issue is triaged.",
            }),
        );
    }
    return intents;
}

/** The release: a person's `ready` unlocks whatever else the labels say, and may be announced. */
function onTriaged(facts: Facts, config: View, platform: Platform): Intents {
    if (!config.settings.lockUntilTriaged) return [];
    const intents: IntentFor<TriageQueueDeclaration>[] = [];
    if (facts.locked) {
        intents.push(
            platform.intent({
                operation: "unlockIssue",
                desired: { reason: "a person marked the issue ready" },
                explain: "Unlocked the conversation: the issue was marked ready.",
            }),
        );
    }
    if (config.settings.confirmUnlock) {
        intents.push(
            platform.intent({
                operation: "postManagedComment",
                desired: { kind: "notice", topic: "unlock", body: unlocked(facts.author) },
                explain: "Said the issue is ready and its conversation open.",
            }),
        );
    }
    return intents;
}

export const triageQueue: Capability<TriageQueueDeclaration> = {
    declaration: triageQueueDeclaration,

    async evaluate(facts, config, platform) {
        const { arrival } = facts;
        if (arrival === null) return [];
        if (arrival.kind === "label" && arrival.meaning !== TRIAGED) return [];

        // The author opened it; the actor labelled it. Either may be a machine.
        const participant = arrival.kind === "opened" ? facts.author : (facts.actor?.login ?? null);
        if (participant === null) return [];
        if (await platform.ask("isAutomationActor", { login: participant })) return [];

        return arrival.kind === "opened"
            ? onOpened(facts, config, platform)
            : onTriaged(facts, config, platform);
    },
};
