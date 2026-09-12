/**
 * What prQuality decides, and what it refuses to decide: an undetermined
 * resolver answer is never read as "no linked issue".
 */

import { describe, expect, it } from "vitest";
import {
    parseConfig,
    projectCapabilityView,
    type FactsFor,
    type PlatformHandle,
    type PrMeaning,
    type Projection,
    type StructuredExplanation,
    type WorkItemState,
} from "@hiero-hackers/automation-core";
import { prQuality, type PrQualityDeclaration } from "./capability.js";
import { asDeclared, configEnabling, webhookPullRequest } from "../../test/world.js";

const AT = new Date("2026-08-03T09:00:00.000Z");
const REPO = { owner: "hiero-hackers", repo: "sandbox" } as const;
const ITEM = { kind: "pullRequest", number: 12 } as const;

const view = (settings: Readonly<Record<string, unknown>>) =>
    projectCapabilityView(
        prQuality.declaration,
        configEnabling(["prQuality"], ["prQuality"], { prQuality: settings }),
    );

/**
 * The one check the App runs today, switched on. `view({})` is the parked
 * case, because an absent block is parked.
 */
const running = view({ checks: { linkedIssues: { enabled: true } } });

const pullRequest = (state: Partial<WorkItemState<PrMeaning>>) =>
    asDeclared<FactsFor<PrQualityDeclaration>>(
        webhookPullRequest({
            repository: REPO,
            item: ITEM,
            observedAt: AT,
            position: {
                kind: "position",
                state: { meaning: null, blocked: false, closedBy: null, ...state },
                ignored: [],
            } satisfies Projection<PrMeaning>,
        }),
    );

/** A handle carrying one resolver answer, and holding what the probe explained. */
function watch(resolve: PlatformHandle<PrQualityDeclaration>["resolve"]): {
    readonly platform: PlatformHandle<PrQualityDeclaration>;
    readonly explained: StructuredExplanation[];
} {
    const explained: StructuredExplanation[] = [];
    return {
        platform: {
            resolve,
            explain: (explanation) => {
                explained.push(explanation);
            },
        },
        explained,
    };
}

const noneFound = watch(async () => ({ ok: true, value: [] }));

describe("prQuality", () => {
    it("reads an unanswerable resolver as unknown, never as no linked issue", async () => {
        const failed = watch(async () => ({
            ok: false,
            reason: "rateLimited",
            detail: "secondary rate limit on this installation",
        }));
        const open = pullRequest({});

        expect(await prQuality.evaluate(open, running, failed.platform)).toEqual([]);
        // The reason is the report's whole account of the silence, so it is stated in full.
        expect(failed.explained).toEqual([
            {
                capability: "prQuality",
                summary: "Skipped: the linked-issue resolver could not answer.",
                detail: [
                    "resolver reason: rateLimited",
                    "secondary rate limit on this installation",
                ],
            },
        ]);

        // The same pull request, answered: the silence above was the failure.
        expect(await prQuality.evaluate(open, running, noneFound.platform)).toHaveLength(1);
        expect(noneFound.explained).toEqual([]);
    });

    it("says nothing about a pull request that already links an issue", async () => {
        const linked = watch(async () => ({ ok: true, value: [{ kind: "issue", number: 11 }] }));
        expect(await prQuality.evaluate(pullRequest({}), running, linked.platform)).toEqual([]);
    });

    it("says nothing about a merged pull request, and never asks", async () => {
        const unreachable = watch(async () => {
            throw new Error("closure is read before the resolver");
        });
        expect(
            await prQuality.evaluate(
                pullRequest({ closedBy: "merged" }),
                running,
                unreachable.platform,
            ),
        ).toEqual([]);
    });

    it("asks the linkedIssues resolver, once, about the pull request it was given", async () => {
        const asked: { query: string; input: unknown }[] = [];
        const recording = watch(async (query, input) => {
            asked.push({ query, input });
            return { ok: true, value: [] };
        });

        await prQuality.evaluate(pullRequest({}), running, recording.platform);

        expect(asked).toEqual([{ query: "linkedIssues", input: { item: ITEM } }]);
    });

    /** `claims.closed` is `false` rather than absent: an omitted claim is vacuous. */
    it("asks for one managed comment on the observed pull request, claiming it is open", async () => {
        expect(await prQuality.evaluate(pullRequest({}), running, noneFound.platform)).toEqual([
            {
                capability: "prQuality",
                repository: REPO,
                item: ITEM,
                operation: "postManagedComment",
                desired: {
                    kind: "summary",
                    body: "This pull request does not reference an issue. Adding a closing reference keeps the issue and the pull request in step.",
                },
                claims: { meaningsPresent: [], meaningsAbsent: [], closed: false },
                cause: { cause: "pullRequestWithoutLinkedIssue", observedAt: AT },
                explanation: {
                    capability: "prQuality",
                    summary: "No linked issue found on this pull request.",
                    detail: ["checked via the linkedIssues resolver"],
                },
                grace: null,
                idempotencyKey: expect.any(String),
            },
        ]);
    });

    /** D125: an unknown key is a document defect, refused whether or not it runs. */
    it("refuses a configuration that still supplies a marker", () => {
        const result = parseConfig(
            {
                schemaVersion: 2,
                capabilities: { prQuality: { enabled: false, marker: "<!-- x -->" } },
            },
            { revision: "rev-marker", knownCapabilities: [prQuality.declaration] },
        );
        expect(result.ok ? [] : result.errors.map((e) => `${e.code} @ ${e.path}`)).toEqual([
            "unknownKey @ capabilities.prQuality.marker",
        ]);
    });

    /** The spec IS the schema, so the names a maintainer writes are pinned. */
    it("declares the checks a repository may switch on", () => {
        expect(Object.keys(prQuality.declaration.settings)).toEqual(["checks"]);
        expect(view({}).settings).toEqual({ checks: { linkedIssues: { enabled: false } } });
    });

    /**
     * A check runs only where a repository wrote `enabled: true`. The throwing
     * resolver proves an unasked question rather than a discarded answer.
     */
    it("runs no check for a repository that enables none, and never asks", async () => {
        const unreachable = watch(async () => {
            throw new Error("a parked check asks nothing");
        });
        expect(await prQuality.evaluate(pullRequest({}), view({}), unreachable.platform)).toEqual(
            [],
        );
        expect(
            await prQuality.evaluate(
                pullRequest({}),
                view({ checks: { linkedIssues: { enabled: false } } }),
                unreachable.platform,
            ),
        ).toEqual([]);
        expect(unreachable.explained).toEqual([]);
    });

    /** The guide is where the design puts it: on the failure, and nowhere else. */
    it("ends the failing check with the guide the repository configured", async () => {
        const withGuide = view({
            checks: { linkedIssues: { enabled: true, guide: "https://example.test/linking" } },
        });
        const [intent] = await prQuality.evaluate(pullRequest({}), withGuide, noneFound.platform);

        expect(intent?.desired).toEqual({
            kind: "summary",
            body: "This pull request does not reference an issue. Adding a closing reference keeps the issue and the pull request in step. See the guide: https://example.test/linking",
        });
    });

    /** A maintainer copying the design page's whole block gets a rejected file. */
    it("refuses a check the App does not run", () => {
        const result = parseConfig(
            {
                schemaVersion: 2,
                capabilities: {
                    prQuality: { enabled: true, checks: { dcoSignoff: { enabled: true } } },
                },
            },
            { revision: "rev-checks", knownCapabilities: [prQuality.declaration] },
        );
        expect(result.ok ? [] : result.errors.map((e) => `${e.code} @ ${e.path}`)).toEqual([
            "unknownKey @ capabilities.prQuality.checks.dcoSignoff",
        ]);
    });

    /** The nesting is the dependency: a sub-check is a block inside its parent's. */
    it("refuses a sub-check written beside its parent rather than inside it", () => {
        const result = parseConfig(
            {
                schemaVersion: 2,
                capabilities: {
                    prQuality: {
                        enabled: true,
                        checks: {
                            linkedIssues: { enabled: true },
                            assignedIssues: { enabled: true },
                        },
                    },
                },
            },
            { revision: "rev-nesting", knownCapabilities: [prQuality.declaration] },
        );
        expect(result.ok ? [] : result.errors.map((e) => `${e.code} @ ${e.path}`)).toEqual([
            "unknownKey @ capabilities.prQuality.checks.assignedIssues",
        ]);
    });
});
