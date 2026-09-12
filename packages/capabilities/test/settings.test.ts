/**
 * What each seed asks its repository for, and what it does with an answer it
 * cannot read.
 *
 * The specs here are the SEEDS' — the keys each one reads today, not the ones
 * its `design.md` describes. The designs' own config sections are pinned
 * against the toolkit in core, beside the toolkit they prove.
 *
 * The claim the toolkit adds to all three is the one worth a shared suite: a
 * settings block the capability cannot read is REPORTED on the operator
 * surface and produces no intent. Before it, a malformed value fell back to
 * the default silently, and a repository that had written one had no way to
 * learn that nothing was reading it.
 */

import { describe, expect, it } from "vitest";
import {
    projectCapabilityView,
    readSettings,
    type PlatformHandle,
    type StructuredExplanation,
    type TypedDeclaration,
} from "@hiero-hackers/automation-core";
import { intake } from "../src/intake/capability.js";
import { inactivity } from "../src/inactivity/capability.js";
import { INTAKE_SETTINGS } from "../src/intake/settings.js";
import { PR_QUALITY_SETTINGS } from "../src/prQuality/settings.js";
import { INACTIVITY_SETTINGS } from "../src/inactivity/settings.js";
import { configEnabling, sweptIssue, webhookIssue } from "./world.js";

const AT = new Date("2026-09-09T09:00:00.000Z");
const REPO = { owner: "hiero-hackers", repo: "sandbox" } as const;

/** The view a repository supplying `settings` hands the named capability. */
const viewFor = <D extends TypedDeclaration>(
    declaration: D,
    settings: Readonly<Record<string, unknown>>,
) =>
    projectCapabilityView(
        declaration,
        configEnabling([declaration.name], [declaration.name], {
            [declaration.name]: settings,
        }),
    );

function watch<D extends TypedDeclaration>(): {
    readonly platform: PlatformHandle<D>;
    readonly explained: StructuredExplanation[];
} {
    const explained: StructuredExplanation[] = [];
    return {
        platform: {
            resolve: async () => {
                throw new Error("an unusable block is answered before any resolver");
            },
            explain: (explanation) => {
                explained.push(explanation);
            },
        },
        explained,
    };
}

/** intake reads a webhook record; it declares no need, so every group is unread. */
const issue = webhookIssue({ repository: REPO, observedAt: AT });

/** inactivity reads a sweep record: an unread group would be a `factsUnread` skip. */
const swept = sweptIssue({
    repository: REPO,
    observedAt: AT,
    assignees: [
        {
            login: "contributor",
            assignedAt: new Date("2026-07-01T00:00:00.000Z"),
            lastWorkingAt: null,
        },
    ],
});

describe("the seeds' specs", () => {
    it("read the keys their declarations admit, with the defaults they document", () => {
        expect(readSettings(INTAKE_SETTINGS, viewFor(intake.declaration, {}))).toEqual({
            ok: true,
            value: { announce: false },
        });
        expect(readSettings(INACTIVITY_SETTINGS, viewFor(inactivity.declaration, {}))).toEqual({
            ok: true,
            value: {
                exemptBlocked: true,
                remindAfterDays: 14,
                reapAfterDays: 21,
                // Both ladders are opt-in, so a repository that states nothing
                // gets a capability with nothing switched on.
                issues: { enabled: false },
                pullRequests: { enabled: false },
            },
        });
    });

    /** D125's removal, still true one layer down: nothing to supply, nothing to read. */
    it("leave prQuality with no key at all", () => {
        expect(Object.keys(PR_QUALITY_SETTINGS)).toEqual([]);
    });
});

describe("a settings block a seed cannot read", () => {
    it("is reported by intake, which then asks for nothing", async () => {
        const { platform, explained } = watch<typeof intake.declaration>();

        expect(
            await intake.evaluate(
                issue,
                viewFor(intake.declaration, { announce: "yes" }),
                platform,
            ),
        ).toEqual([]);
        expect(explained).toEqual([
            {
                capability: "intake",
                summary:
                    "Skipped: settings unusable — capabilities.intake.settings.announce: must be true or false",
                detail: [],
            },
        ]);
    });

    it("is reported by inactivity before it looks at a single stale item", async () => {
        const { platform, explained } = watch<typeof inactivity.declaration>();

        expect(
            await inactivity.evaluate(
                swept,
                viewFor(inactivity.declaration, { remindAfterDays: -1 }),
                platform,
            ),
        ).toEqual([]);
        expect(explained).toEqual([
            {
                capability: "inactivity",
                summary:
                    "Skipped: settings unusable — capabilities.inactivity.settings.remindAfterDays: must be a whole number of days, zero or more",
                detail: [],
            },
        ]);
    });

    /**
     * The same rule from the other side: reaping on the label reason demands
     * the meaning that reason is named for.
     */
    it("is reported by inactivity when a reason needs a meaning nobody mapped", async () => {
        const { platform, explained } = watch<typeof inactivity.declaration>();
        const unmapped = projectCapabilityView(
            inactivity.declaration,
            configEnabling(
                ["inactivity"],
                ["inactivity"],
                {
                    inactivity: {
                        pullRequests: {
                            enabled: true,
                            reapWhen: { needsRevision: { enabled: true } },
                        },
                    },
                },
                { labels: { blocked: "status: blocked" } },
            ),
        );

        expect(await inactivity.evaluate(swept, unmapped, platform)).toEqual([]);
        expect(explained).toEqual([
            {
                capability: "inactivity",
                summary:
                    "Skipped: settings unusable — capabilities.inactivity.settings.pullRequests.reapWhen.needsRevision.enabled: reaping on needsRevision needs that meaning mapped, and this repository has not mapped it",
                detail: [],
            },
        ]);
    });

    /**
     * The rule the toolkit cannot state: a setting that demands a MAPPING.
     * Reaping on `needsRevision` needs the meaning mapped, or the reason could
     * never fire and the repository would never learn why.
     */
    it("is reported by inactivity when a setting needs a meaning nobody mapped", async () => {
        const { platform, explained } = watch<typeof inactivity.declaration>();
        const unmapped = projectCapabilityView(
            inactivity.declaration,
            configEnabling(
                ["inactivity"],
                ["inactivity"],
                {
                    inactivity: {
                        pullRequests: {
                            enabled: true,
                            reapWhen: { needsRevision: { enabled: true } },
                        },
                    },
                },
                { labels: { awaitingTriage: "status: triage" } },
            ),
        );

        expect(await inactivity.evaluate(swept, unmapped, platform)).toEqual([]);
        expect(explained).toEqual([
            {
                capability: "inactivity",
                summary:
                    "Skipped: settings unusable — capabilities.inactivity.settings.pullRequests.reapWhen.needsRevision.enabled: reaping on needsRevision needs that meaning mapped, and this repository has not mapped it",
                detail: [],
            },
        ]);
    });
});
