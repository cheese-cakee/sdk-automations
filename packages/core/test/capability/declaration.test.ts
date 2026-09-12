import { describe, expect, it } from "vitest";
import {
    validateCapabilityDeclarations,
    type CapabilityDeclaration,
} from "../../src/capability/index.js";

const declaration: CapabilityDeclaration = {
    name: "prQuality",
    triggers: [{ kind: "event", event: "pull_request" }],
    configKeys: ["checks"],
    requiredMappings: { labels: ["needsReview"] },
    facts: ["pullRequest"],
    /**
     * Empty, and it is the study's finding that it has to be: the webhook
     * producer of `pull_request` reads no group, so `needs: ["review"]` here
     * is the declaration the boot check exists to refuse — asserted below.
     */
    needs: [],
    resolvers: ["linkedIssues"],
    intents: ["postManagedComment", "applyMappedLabel"],
    operationalNeeds: {
        schedule: false,
        durableState: "required",
        crossItemCoordination: false,
        externalDelivery: false,
    },
};

describe("validateCapabilityDeclarations", () => {
    it("accepts a valid direct declaration set", () => {
        expect(validateCapabilityDeclarations([declaration])).toEqual([]);
    });

    it("rejects duplicate declaration names with the boot-boundary error", () => {
        expect(validateCapabilityDeclarations([declaration, declaration])).toContain(
            'duplicate capability name "prQuality"',
        );
    });

    it("returns every structural, duplicate-entry, and catalogue-name error", () => {
        const errors = validateCapabilityDeclarations([
            {
                ...declaration,
                name: "PR-Quality",
                triggers: [],
                configKeys: ["checks", "checks"],
                requiredMappings: { labels: ["almostReady", "almostReady"] },
                facts: ["unknownKind", "unknownKind"],
                needs: ["unknownGroup", "unknownGroup"],
                resolvers: ["unknownResolver", "unknownResolver"],
                intents: ["unknownOperation", "unknownOperation"],
            },
            {
                ...declaration,
                name: "scheduled",
                triggers: [
                    { kind: "event", event: "issues" },
                    { kind: "schedule", description: "daily" },
                ],
                operationalNeeds: { ...declaration.operationalNeeds, schedule: false },
            },
        ]);

        expect(errors.join("\n")).toContain("camelCase configuration key");
        expect(errors.join("\n")).toContain("at least one trigger");
        // Every error names the declaration it came from. With two bad
        // declarations in one list, an unattributed error tells a maintainer
        // that SOMETHING is wrong and not which capability to open.
        expect(errors.join("\n")).toContain('capability "PR-Quality": at least one trigger');
        expect(errors.join("\n")).toContain(
            'capability "PR-Quality": fact kind "unknownKind" is not in the fact catalogue',
        );
        /**
         * Attribution is also what makes the schedule check a check. The
         * mismatch belongs to `scheduled`, which declares a schedule trigger
         * among two; `PR-Quality` declares no triggers at all and must not be
         * accused of one. A quantifier slip over the trigger list moves the
         * error from the first capability to the second and leaves the
         * unattributed fragment above passing.
         */
        expect(errors.join("\n")).toContain(
            'capability "scheduled": declares a schedule trigger but operationalNeeds.schedule is false',
        );
        expect(errors.join("\n")).not.toContain(
            'capability "PR-Quality": declares a schedule trigger',
        );
        expect(errors.join("\n")).toContain('duplicate configKeys entry "checks"');
        expect(errors.join("\n")).toContain(
            'duplicate requiredMappings.labels entry "almostReady"',
        );
        /**
         * D84 — a meaning no repository may map is a requirement no repository
         * can satisfy, so the catalogue check covers `requiredMappings` the
         * way it already covered facts, resolvers, and intents. Each family
         * has its own closed set, so the error names the family it judged in.
         */
        expect(errors.join("\n")).toContain(
            'capability "PR-Quality": required meaning "almostReady" is not in the labels family',
        );
        expect(errors.join("\n")).toContain('duplicate facts entry "unknownKind"');
        expect(errors.join("\n")).toContain('duplicate needs entry "unknownGroup"');
        expect(errors.join("\n")).toContain('duplicate resolvers entry "unknownResolver"');
        expect(errors.join("\n")).toContain('duplicate intents entry "unknownOperation"');
        expect(errors.join("\n")).toContain(
            'fact group "unknownGroup" is not in the fact catalogue',
        );
        expect(errors.join("\n")).toContain('resolver "unknownResolver"');
        expect(errors.join("\n")).toContain('intent "unknownOperation"');
        expect(errors.join("\n")).toContain("operationalNeeds.schedule is false");
    });

    /**
     * facts.md §3: `review` is the pull request's alone, so an issue-only
     * declaration needing it names a group no record it receives could hold.
     * Refused once at boot, rather than skipped in silence on every record.
     */
    it("refuses a need no declared kind carries", () => {
        expect(
            validateCapabilityDeclarations([
                { ...declaration, facts: ["issue"], needs: ["review"] },
            ]),
        ).toEqual(['capability "prQuality": no declared fact kind carries the group "review"']);
    });

    /**
     * The defect this check was built for, as the declaration that found it:
     * prQuality's own design page asked for `needs: ["review"]` on a
     * `pull_request` trigger, and the platform answered by skipping the
     * capability `factsUnread` on every delivery, silently, forever.
     *
     * The message has to name all three things a maintainer needs — which
     * trigger, which group, and who does read it — because the fix is always
     * one of two moves: change the trigger, or drop the need.
     */
    it("refuses a need the producer its trigger names never reads", () => {
        expect(validateCapabilityDeclarations([{ ...declaration, needs: ["review"] }])).toEqual([
            'capability "prQuality": the "pull_request" trigger leaves "review" unread on a pullRequest record, so every delivery it wakes is skipped — read by: sweep',
        ]);
    });

    /**
     * The same need on the trigger that does read it is the positive half, and
     * it is inactivity's shape: both kinds declared, so `review` is judged
     * against the pull request and skipped for the issue that cannot hold it.
     */
    it("admits the same need on a schedule trigger, which the sweep answers", () => {
        expect(
            validateCapabilityDeclarations([
                {
                    ...declaration,
                    triggers: [{ kind: "schedule", description: "daily" }],
                    facts: ["issue", "pullRequest"],
                    needs: ["review"],
                    operationalNeeds: { ...declaration.operationalNeeds, schedule: true },
                },
            ]),
        ).toEqual([]);
    });

    /**
     * A trigger naming an event no producer wakes on is the same defect one
     * step earlier: nothing ever delivers, so the capability is dead code
     * whatever it needs. `issue_comment` was the real example until the study
     * built its producer; `pull_request_review` is the next one — an event two
     * designs want and no producer wakes on, not a typo.
     */
    it("refuses a trigger no producer wakes on", () => {
        expect(
            validateCapabilityDeclarations([
                { ...declaration, triggers: [{ kind: "event", event: "pull_request_review" }] },
            ]),
        ).toEqual([
            'capability "prQuality": no producer wakes on the "pull_request_review" trigger — the events the platform consumes are issues, issue_comment, pull_request',
        ]);
    });

    it("keeps operation facts out of the declaration shape", () => {
        expect(declaration.intents).toEqual(["postManagedComment", "applyMappedLabel"]);
        expect(Object.keys(declaration).sort()).toEqual([
            "configKeys",
            "facts",
            "intents",
            "name",
            "needs",
            "operationalNeeds",
            "requiredMappings",
            "resolvers",
            "triggers",
        ]);
    });
});
