/**
 * What intake decides at the entry gate. Each refusal is paired with the
 * input that does produce a label intent.
 */

import { describe, expect, it } from "vitest";
import {
    projectCapabilityView,
    type IssueMeaning,
    type PlatformHandle,
    type Projection,
    type StructuredExplanation,
    type WorkItemState,
} from "@hiero-hackers/automation-core";
import { intake, type IntakeDeclaration } from "./capability.js";
import { configEnabling, webhookIssue } from "../../test/world.js";

const AT = new Date("2026-08-03T09:00:00.000Z");
const REPO = { owner: "hiero-hackers", repo: "sandbox" } as const;
const ITEM = { kind: "issue", number: 11 } as const;

const announcing = configEnabling(["intake"], ["intake"], { intake: { announce: true } });
const silent = configEnabling(["intake"], ["intake"]);
/** The same repository, having mapped no meanings at all. */
const unmapped = {
    ...announcing,
    mappings: { labels: {}, commands: {}, skills: {}, alerts: {} },
};

const issue = (state: Partial<WorkItemState<IssueMeaning>>) =>
    webhookIssue({
        repository: REPO,
        item: ITEM,
        observedAt: AT,
        position: {
            kind: "position",
            state: { meaning: null, blocked: false, closedBy: null, ...state },
            ignored: [],
        } satisfies Projection<IssueMeaning>,
    });

/** The same issue, seen holding more than one position at once. */
const conflicted = (...positions: readonly IssueMeaning[]) =>
    webhookIssue({
        repository: REPO,
        item: ITEM,
        observedAt: AT,
        position: {
            kind: "conflict",
            positions,
            blocked: false,
            closedBy: null,
            ignored: [],
        } satisfies Projection<IssueMeaning>,
    });

/**
 * A handle that records what intake explained, answering its one resolver.
 * The default answer is "a person".
 */
function watch(
    actor: Awaited<ReturnType<PlatformHandle<IntakeDeclaration>["resolve"]>> = {
        ok: true,
        value: false,
    },
): {
    readonly platform: PlatformHandle<IntakeDeclaration>;
    readonly explained: StructuredExplanation[];
    readonly asked: string[];
} {
    const explained: StructuredExplanation[] = [];
    const asked: string[] = [];
    return {
        platform: {
            resolve: async (_query, input) => {
                asked.push(input.login);
                return await Promise.resolve(actor);
            },
            explain: (explanation) => {
                explained.push(explanation);
            },
        },
        explained,
        asked,
    };
}

describe("intake", () => {
    it("Issue opened by a bot", async () => {
        const { platform, explained, asked } = watch({ ok: true, value: true });

        expect(
            await intake.evaluate(
                webhookIssue({ author: "renovate[bot]" }),
                projectCapabilityView(intake.declaration, announcing),
                platform,
            ),
        ).toEqual([]);
        // The AUTHOR, not the actor: the guard asks who opened the issue.
        expect(asked).toEqual(["renovate[bot]"]);
        // Silence, not a report: a machine's issue is not a problem.
        expect(explained).toEqual([]);
    });

    it("stops, and says so, when nobody can answer who opened the issue", async () => {
        const { platform, explained } = watch({
            ok: false,
            reason: "rateLimited",
            detail: "secondary rate limit",
        });

        expect(
            await intake.evaluate(
                issue({}),
                projectCapabilityView(intake.declaration, announcing),
                platform,
            ),
        ).toEqual([]);
        expect(explained).toEqual([
            {
                capability: "intake",
                summary:
                    "Skipped: nobody could say whether this issue was opened by an automation.",
                detail: ["the actor lookup answered rateLimited"],
            },
        ]);
    });

    it("names both positions of a conflicted item, and repairs neither (D35)", async () => {
        const { platform, explained } = watch();

        expect(
            await intake.evaluate(
                conflicted("ready", "inProgress"),
                projectCapabilityView(intake.declaration, announcing),
                platform,
            ),
        ).toEqual([]);
        expect(explained).toEqual([
            {
                capability: "intake",
                summary: "Skipped: the item holds more than one workflow position.",
                detail: [
                    "conflicting: ready, inProgress",
                    "a conflict is reported, never repaired (D35)",
                ],
            },
        ]);
    });

    it("will not triage a repository that has not mapped awaitingTriage", async () => {
        const { platform, explained } = watch();
        const fresh = issue({});

        expect(
            await intake.evaluate(
                fresh,
                projectCapabilityView(intake.declaration, unmapped),
                platform,
            ),
        ).toEqual([]);
        expect(explained).toEqual([
            {
                capability: "intake",
                summary: "Skipped: this repository has not mapped awaitingTriage.",
                detail: ["intake cannot triage without a mapped triage meaning"],
            },
        ]);

        // The same issue in a repository that mapped it: the silence was the mapping.
        expect(
            await intake.evaluate(
                fresh,
                projectCapabilityView(intake.declaration, announcing),
                platform,
            ),
        ).toHaveLength(2);
    });

    it("leaves an issue that already holds a position, silently", async () => {
        const { platform, explained } = watch();
        expect(
            await intake.evaluate(
                issue({ meaning: "inProgress" }),
                projectCapabilityView(intake.declaration, announcing),
                platform,
            ),
        ).toEqual([]);
        expect(explained).toEqual([]);
    });

    it("leaves a closed issue alone", async () => {
        expect(
            await intake.evaluate(
                issue({ closedBy: "closedByHuman" }),
                projectCapabilityView(intake.declaration, announcing),
                watch().platform,
            ),
        ).toEqual([]);
    });

    /** Both requests in full: one occasion, but the announcement claims only openness. */
    it("asks for the label and the announcement, in that order, on their own claims", async () => {
        const occasion = { cause: "issueWithoutPosition", observedAt: AT };
        const claim = { meaningsPresent: [], meaningsAbsent: ["awaitingTriage"], closed: false };
        const announceClaim = { meaningsPresent: [], meaningsAbsent: [], closed: false };

        expect(
            await intake.evaluate(
                issue({}),
                projectCapabilityView(intake.declaration, announcing),
                watch().platform,
            ),
        ).toEqual([
            {
                capability: "intake",
                repository: REPO,
                item: ITEM,
                operation: "applyMappedLabel",
                desired: { meaning: "awaitingTriage", cause: "intakeObserved" },
                claims: claim,
                cause: occasion,
                explanation: {
                    capability: "intake",
                    summary: "New issue placed in triage.",
                    detail: ["the issue carried no mapped workflow meaning"],
                },
                grace: null,
                idempotencyKey: expect.any(String),
            },
            {
                capability: "intake",
                repository: REPO,
                item: ITEM,
                operation: "postManagedComment",
                desired: {
                    kind: "notice",
                    body: "Thanks for opening this. It has been placed in the triage queue.",
                },
                claims: announceClaim,
                cause: occasion,
                explanation: {
                    capability: "intake",
                    summary: "Announced the triage placement.",
                    detail: ["announce is enabled for this repository"],
                },
                grace: null,
                idempotencyKey: expect.any(String),
            },
        ]);
    });

    it("triages without announcing when announce is not configured", async () => {
        const intents = await intake.evaluate(
            issue({}),
            projectCapabilityView(intake.declaration, silent),
            watch().platform,
        );
        expect(intents.map((intent) => intent.operation)).toEqual(["applyMappedLabel"]);
    });
});
