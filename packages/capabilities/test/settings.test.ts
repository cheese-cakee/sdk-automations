/**
 * What each seed asks its repository for, and what the platform does with an
 * answer it cannot read.
 *
 * The specs here are the SEEDS' — the keys each one reads today, not the ones
 * its `design.md` describes. The designs' own config sections are pinned
 * against the toolkit in core, beside the toolkit they prove.
 *
 * The claim worth a shared suite is the one all three now share: a settings
 * block the capability could not read never reaches it, because the parser
 * read it first. So the rejections below are `parseConfig`'s, at the path in
 * the maintainer's own file, and the capability's `evaluate` has no settings
 * caption left to fail in.
 */

import { describe, expect, it } from "vitest";
import {
    parseConfig,
    projectCapabilityView,
    type PlatformHandle,
    type StructuredExplanation,
    type TypedDeclaration,
} from "@hiero-hackers/automation-core";
import { CAPABILITIES } from "../src/index.js";
import { intake } from "../src/intake/capability.js";
import { inactivity } from "../src/inactivity/capability.js";
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

/** One capability's block, offered to the parser on its own. */
const parsed = (declaration: TypedDeclaration, settings: Readonly<Record<string, unknown>>) =>
    parseConfig(
        {
            schemaVersion: 2,
            capabilities: { [declaration.name]: { enabled: true, ...settings } },
            mappings: { labels: { awaitingTriage: "status: triage" } },
        },
        { revision: "rev-settings", knownCapabilities: [declaration] },
    );

function watch<D extends TypedDeclaration>(): {
    readonly platform: PlatformHandle<D>;
    readonly explained: StructuredExplanation[];
} {
    const explained: StructuredExplanation[] = [];
    return {
        platform: {
            // Every row here is about a settings block, so the one resolver
            // any of these capabilities asks answers "a person" and stands
            // aside: a bot-authored record would be a different test.
            resolve: async () => await Promise.resolve({ ok: true, value: false }),
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
        expect(viewFor(intake.declaration, {}).settings).toEqual({ announce: false });
        expect(viewFor(inactivity.declaration, {}).settings).toEqual({
            exemptBlocked: true,
            // Hours: a duration is written `14d` and resolves to 336.
            remindAfter: 14 * 24,
            // The root's release clock is a section, so it is always read: it
            // is the default every level inherits, never consent of its own.
            reap: { after: 21 * 24 },
            // Both ladders are opt-in, so a repository that states nothing
            // gets a capability with nothing switched on.
            issues: { enabled: false },
            pullRequests: { enabled: false },
        });
    });

    /**
     * D125's removal, still true one layer down: nothing to supply, nothing to
     * read. WHICH seeds answer that way is the registry's to say — the day one
     * of them declares its first key, that is a change to its own folder and
     * its own tests, and this claim is about the ones that still do not.
     */
    it("hand a seed whose spec declares no key nothing at all", () => {
        const names = CAPABILITIES.map(({ declaration }) => declaration.name);
        const keyless = CAPABILITIES.filter(
            ({ declaration }) => Object.keys(declaration.settings).length === 0,
        );
        expect(keyless.length).toBeGreaterThan(0);

        const config = configEnabling(names, names);
        for (const { declaration } of keyless) {
            expect(config.capabilities[declaration.name]?.settings, declaration.name).toEqual({});
        }
    });
});

describe("a settings block a seed cannot read", () => {
    /**
     * D38 extended from key names to values (C1). The file is refused whole,
     * with the path a maintainer edits — where the same file used to parse
     * clean and intake reported itself unusable on every delivery it met.
     */
    it("is refused for intake before any delivery reaches it", () => {
        const result = parsed(intake.declaration, { announce: "yes" });

        expect(result.ok ? [] : result.errors).toEqual([
            {
                code: "settingInvalid",
                path: "capabilities.intake.announce",
                message: "capabilities.intake.announce: must be true or false",
            },
        ]);
    });

    it("is refused for inactivity, at the clock that is wrong", () => {
        const result = parsed(inactivity.declaration, { remindAfter: -1 });

        expect(result.ok ? [] : result.errors).toEqual([
            {
                code: "settingInvalid",
                path: "capabilities.inactivity.remindAfter",
                message:
                    'capabilities.inactivity.remindAfter: must be a duration: a whole number of hours or days, written "4h" or "14d"',
            },
        ]);
    });

    /**
     * The rule the toolkit cannot state, and so the one problem still spoken
     * per delivery: a setting that demands a MAPPING. Reaping on
     * `needsRevision` needs the meaning mapped, or the reason could never fire
     * and the repository would never learn why.
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
                    "Skipped: settings unusable — capabilities.inactivity.pullRequests.reapWhen.needsRevision.enabled: reaping on needsRevision needs that meaning mapped, and this repository has not mapped it",
                detail: [],
            },
        ]);
    });

    /**
     * The guard belongs to the reason, not to the capability.
     *
     * A repository that never switched that reason on has nothing to fix, so
     * the unmapped meaning is not its problem and the ladder it DID switch on
     * runs with nothing spoken.
     */
    it("is not reported when the reason that needs the meaning is switched off", async () => {
        const { platform, explained } = watch<typeof inactivity.declaration>();
        const issuesOnly = projectCapabilityView(
            inactivity.declaration,
            configEnabling(
                ["inactivity"],
                ["inactivity"],
                { inactivity: { issues: { enabled: true } } },
                { labels: { awaitingTriage: "status: triage" } },
            ),
        );

        expect(await inactivity.evaluate(swept, issuesOnly, platform)).toMatchObject([
            { operation: "postManagedComment" },
        ]);
        expect(explained).toEqual([]);
    });

    /**
     * The positive half of the same guard: with the meaning mapped, the
     * capability runs — so the skip above is the rule firing and not the
     * fixture being unreadable for some other reason.
     */
    it("runs once the meaning that reason names is mapped", async () => {
        const { platform, explained } = watch<typeof inactivity.declaration>();
        const mapped = projectCapabilityView(
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
                { labels: { needsRevision: "status: needs revision" } },
            ),
        );

        expect(await inactivity.evaluate(swept, mapped, platform)).toEqual([]);
        expect(explained).toEqual([]);
    });

    /** intake still reads the block it was handed, once the file is valid. */
    it("announces when the value the parser accepted says so", async () => {
        const { platform } = watch<typeof intake.declaration>();
        const announced = await intake.evaluate(
            issue,
            viewFor(intake.declaration, { announce: true }),
            platform,
        );
        expect(announced.map(({ operation }) => operation)).toEqual([
            "applyMappedLabel",
            "postManagedComment",
        ]);
    });
});
