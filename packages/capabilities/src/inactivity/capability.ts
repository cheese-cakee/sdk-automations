/**
 * inactivity — remind about stalled work, then release it (`design.md`).
 *
 * Two ladders, one per item kind (D143). This file demands the mappings its
 * settings name and branches on the record's kind; each ladder is its own file.
 */

import type { Capability, CapabilityView } from "@hiero-hackers/automation-core/author";
import { ladderContext, type InactivitySettings } from "./context.js";
import { inactivityDeclaration, type InactivityDeclaration } from "./declaration.js";
import { onIssue } from "./issues.js";
import { onPullRequest } from "./pull-requests.js";

export { inactivityDeclaration, type InactivityDeclaration } from "./declaration.js";

/** The one settings rule the toolkit cannot carry: a setting demanding a mapping, in the parser's words. */
function unmappedDemand(
    settings: InactivitySettings,
    view: CapabilityView<InactivityDeclaration>,
): string | null {
    const { pullRequests } = settings;
    const demandsNeedsRevision =
        pullRequests.enabled && pullRequests.reapWhen.needsRevision.enabled;
    if (!demandsNeedsRevision || view.mapped.labels.includes("needsRevision")) return null;
    return "capabilities.inactivity.pullRequests.reapWhen.needsRevision.enabled: reaping on needsRevision needs that meaning mapped, and this repository has not mapped it";
}

export const inactivity: Capability<InactivityDeclaration> = {
    declaration: inactivityDeclaration,

    async evaluate(facts, view, platform) {
        const demanded = unmappedDemand(view.settings, view);
        if (demanded !== null) return platform.skip(`Skipped: settings unusable — ${demanded}`);

        const context = ladderContext(view.settings, facts, platform);
        return facts.kind === "issue"
            ? await onIssue(facts, context)
            : await onPullRequest(facts, context);
    },
};
