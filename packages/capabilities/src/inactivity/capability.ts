/**
 * inactivity — remind about stalled work, then release it (`design.md`).
 *
 * Two ladders, one per item kind (D143). An assigned issue with no open pull
 * request is reminded, then its stale assignees are released; a pull request
 * whose ball is the contributor's — draft, changes requested, or carrying
 * `needsRevision` — is reminded, then closed with any stale assignment on its
 * linked issues released alongside. Maintainer staleness and paused work are
 * never touched.
 *
 * This file reads the settings, refuses the ones it cannot use, and branches on
 * the record's kind. Each ladder is its own file — `issues.ts`,
 * `pull-requests.ts` — and takes the context `context.ts` builds rather than
 * closing over this function; `messages.ts` owns everything it says,
 * `ladder.ts` what a ladder is and who is still on one, `settings.ts` the spec
 * the repository fills in. The clocks, the three stops and the bot filter are
 * core's (`capability/facts.ts`): they are true of any capability's record, and
 * P3 forbids reaching a sibling for them. Every fact either ladder judges
 * arrives on the record (contracts/facts.md §1): there is no resolver here but
 * the actor lookup.
 */

import {
    readSettings,
    skipped,
    unusable,
    type Capability,
    type CapabilityView,
    type MappableMeaning,
} from "@hiero-hackers/automation-core";
import { ladderContext, type InactivitySettings } from "./context.js";
import { inactivityDeclaration, type InactivityDeclaration } from "./declaration.js";
import { onIssue } from "./issues.js";
import { onPullRequest } from "./pull-requests.js";
import { INACTIVITY_SETTINGS } from "./settings.js";

export { inactivityDeclaration, type InactivityDeclaration } from "./declaration.js";

/**
 * The one settings rule the toolkit cannot carry: a setting that demands a
 * MAPPING. `capability-kits.md` §3.3 admits no conditional field and no
 * cross-field rule beyond the cascade, so "reaping on `needsRevision` needs
 * that meaning mapped" is a guard, worded exactly as `unusable` words its own
 * problems so a maintainer meets one wording for one kind of mistake.
 */
function unusableMappings(
    settings: InactivitySettings,
    view: CapabilityView<InactivityDeclaration>,
): readonly string[] {
    const at = (path: string, message: string): string =>
        `capabilities.inactivity.settings.${path}: ${message}`;
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
        const settings = readSettings(INACTIVITY_SETTINGS, view);
        if (!settings.ok) return unusable(settings.problems, platform, "inactivity");
        const [demanded, ...alsoDemanded] = unusableMappings(settings.value, view);
        if (demanded !== undefined) {
            return skipped(
                platform,
                "inactivity",
                `Skipped: settings unusable — ${demanded}`,
                ...alsoDemanded,
            );
        }

        const context = ladderContext(settings.value, facts, platform);
        return facts.kind === "issue"
            ? await onIssue(facts, context)
            : await onPullRequest(facts, context);
    },
};
