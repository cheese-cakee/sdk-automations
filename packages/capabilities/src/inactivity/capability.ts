/**
 * inactivity — remind about stalled work, then release it (`design.md`).
 *
 * Two ladders, one per item kind (D143). This file demands the mappings its
 * settings name and branches on the record's kind; each ladder is its own file.
 */

import {
    skipped,
    type Capability,
    type CapabilityView,
    type MappableMeaning,
} from "@hiero-hackers/automation-core";
import { ladderContext, type InactivitySettings } from "./context.js";
import { inactivityDeclaration, type InactivityDeclaration } from "./declaration.js";
import { onIssue } from "./issues.js";
import { onPullRequest } from "./pull-requests.js";

export { inactivityDeclaration, type InactivityDeclaration } from "./declaration.js";

/**
 * The one settings rule the toolkit cannot carry: a setting that demands a
 * mapping. Worded and pathed as the parser words the same kind of mistake.
 */
function unusableMappings(
    settings: InactivitySettings,
    view: CapabilityView<InactivityDeclaration>,
): readonly string[] {
    const at = (path: string, message: string): string =>
        `capabilities.inactivity.${path}: ${message}`;
    const unmapped = (meaning: MappableMeaning): boolean => !view.mapped.labels.includes(meaning);
    const problems: string[] = [];
    const { pullRequests } = settings;
    if (
        pullRequests.enabled &&
        pullRequests.reapWhen.needsRevision.enabled &&
        unmapped("needsRevision")
    ) {
        problems.push(
            at(
                "pullRequests.reapWhen.needsRevision.enabled",
                "reaping on needsRevision needs that meaning mapped, and this repository has not mapped it",
            ),
        );
    }
    return problems;
}

export const inactivity: Capability<InactivityDeclaration> = {
    declaration: inactivityDeclaration,

    async evaluate(facts, view, platform) {
        const [demanded, ...alsoDemanded] = unusableMappings(view.settings, view);
        if (demanded !== undefined) {
            return skipped(
                platform,
                "inactivity",
                `Skipped: settings unusable — ${demanded}`,
                ...alsoDemanded,
            );
        }

        const context = ladderContext(view.settings, facts, platform);
        return facts.kind === "issue"
            ? await onIssue(facts, context)
            : await onPullRequest(facts, context);
    },
};
