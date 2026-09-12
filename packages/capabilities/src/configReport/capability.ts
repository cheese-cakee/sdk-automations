/**
 * configReport — the pull request's own report on `automations.yml`, built
 * against `design.md`. The rendering is `render.ts`; the guards are here.
 *
 * Content at a pull request's head sha is fork-authored: a report input only.
 */

import {
    declareCapability,
    intentFactoryFor,
    isOpen,
    skipped,
    type Capability,
} from "@hiero-hackers/automation-core";
import { renderReport } from "./render.js";
import { CONFIG_REPORT_SETTINGS } from "./settings.js";

export const configReportDeclaration = declareCapability({
    name: "configReport",
    triggers: [{ kind: "event", event: "pull_request" }],
    settings: CONFIG_REPORT_SETTINGS,
    requiredMappings: {},
    facts: ["pullRequest"],
    /** No group: the report is rendered from the resolver's answer alone. */
    needs: [],
    resolvers: ["configAtHead"],
    intents: ["postManagedComment"],
    operationalNeeds: {
        schedule: false,
        durableState: "none",
        crossItemCoordination: false,
        externalDelivery: false,
    },
});

export type ConfigReportDeclaration = typeof configReportDeclaration;

export const configReport: Capability<ConfigReportDeclaration> = {
    declaration: configReportDeclaration,

    async evaluate(facts, _config, platform) {
        // Closure is carried on both projection branches (D59).
        if (!isOpen(facts)) return [];

        // The resolver answers both halves — touched, and what the file parses
        // to — so it is asked above the "touched" guard (D51).
        const proposed = await platform.resolve("configAtHead", { item: facts.item });
        if (!proposed.ok) {
            return skipped(
                platform,
                "configReport",
                "Skipped: the proposed configuration could not be read.",
                `resolver reason: ${proposed.reason}`,
                proposed.detail,
            );
        }
        if (!proposed.value.touched) return [];

        const make = intentFactoryFor(configReportDeclaration, {
            repository: facts.repository,
            item: facts.item,
            observedAt: facts.observedAt,
        });
        return [
            make({
                operation: "postManagedComment",
                desired: {
                    kind: "summary",
                    body: renderReport(proposed.value.revision, proposed.value.result),
                },
                cause: "pullRequestChangesConfiguration",
                claims: { closed: false },
                explain: {
                    summary: "This pull request changes automations.yml.",
                    detail: [
                        `proposed configuration read at revision ${proposed.value.revision}`,
                        proposed.value.result.ok
                            ? "the proposed file parses"
                            : `the proposed file is rejected, with ${String(proposed.value.result.errors.length)} errors`,
                    ],
                },
            }),
        ];
    },
};
