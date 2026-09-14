/**
 * prQuality — one dashboard comment telling a contributor what stops their
 * pull request being ready to review (`design.md`). One of the design's five
 * checks is built; the words are `messages.ts`.
 */

import { declareCapability, type Capability } from "@hiero-hackers/automation-core/author";
import { noLinkedIssue } from "./messages.js";
import { PR_QUALITY_SETTINGS } from "./settings.js";

export const prQualityDeclaration = declareCapability({
    name: "prQuality",
    triggers: [{ kind: "event", event: "pull_request" }],
    settings: PR_QUALITY_SETTINGS,
    resolvers: ["linkedIssues"],
    intents: ["postManagedComment"],
});

export type PrQualityDeclaration = typeof prQualityDeclaration;

export const prQuality: Capability<PrQualityDeclaration> = {
    declaration: prQualityDeclaration,

    async evaluate(facts, config, platform) {
        const check = config.settings.checks.linkedIssues;
        if (!check.enabled) return [];

        const linked = await platform.ask("linkedIssues", { item: facts.item });
        if (linked.length > 0) return [];

        return [
            platform.intent({
                operation: "postManagedComment",
                desired: { kind: "summary", body: noLinkedIssue(check.guide) },
                cause: "pullRequestWithoutLinkedIssue",
                explain: "Asked for a linked issue on this pull request.",
            }),
        ];
    },
};
