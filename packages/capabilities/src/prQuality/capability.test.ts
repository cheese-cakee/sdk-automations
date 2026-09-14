/**
 * What prQuality decides, and what it refuses to decide: an undetermined
 * resolver answer is never read as "no linked issue".
 */

import { describe, expect, it } from "vitest";
import {
    handleFor,
    parseConfig,
    projectCapabilityView,
    type PrMeaning,
    type Projection,
    type ResolverSource,
    type WorkItemState,
} from "@hiero-hackers/automation-core";
import { prQuality, prQualityDeclaration } from "./capability.js";
import {
    answering,
    configEnabling,
    factsFor,
    OBSERVED_AT,
    REPOSITORY,
    webhookPullRequest,
} from "@hiero-hackers/automation-core/author/testing";

const ITEM = { kind: "pullRequest", number: 12 } as const;

const view = (settings: Readonly<Record<string, unknown>>) =>
    projectCapabilityView(
        prQuality.declaration,
        configEnabling(["prQuality"], [prQuality.declaration], { prQuality: settings }),
    );

/**
 * The one check the App runs today, switched on. `view({})` is the parked
 * case, because an absent block is parked.
 */
const running = view({ checks: { linkedIssues: { enabled: true } } });

const pullRequest = (state: Partial<WorkItemState<PrMeaning>>) =>
    factsFor(
        prQuality.declaration,
        webhookPullRequest({
            item: ITEM,
            position: {
                kind: "position",
                state: { meaning: null, blocked: false, closedBy: null, ...state },
                ignored: [],
            } satisfies Projection<PrMeaning>,
        }),
    );

const noneFound = answering({ ok: true, value: [] });

describe("prQuality", () => {
    it("reads an unanswerable resolver as unknown, never as no linked issue", async () => {
        const open = pullRequest({});
        const failed = handleFor(
            prQualityDeclaration,
            open,
            answering({
                ok: false,
                reason: "rateLimited",
                detail: "secondary rate limit on this installation",
            }),
        );

        // The platform ends the evaluation; the capability neither guards nor catches.
        await expect(prQuality.evaluate(open, running, failed)).rejects.toBeDefined();
        expect(failed.skipped).toBe(true);
        // The reason is the report's whole account of the silence, so it is stated in full.
        expect(failed.explanations).toEqual([
            {
                capability: "prQuality",
                summary: "Skipped: the linkedIssues resolver could not answer.",
                detail: [
                    "resolver reason: rateLimited",
                    "secondary rate limit on this installation",
                ],
            },
        ]);

        // The same pull request, answered: the silence above was the failure.
        const answered = handleFor(prQualityDeclaration, open, noneFound);
        expect(await prQuality.evaluate(open, running, answered)).toHaveLength(1);
        expect(answered.explanations).toEqual([]);
    });

    it("says nothing about a pull request that already links an issue", async () => {
        const open = pullRequest({});
        const linked = handleFor(
            prQualityDeclaration,
            open,
            answering({ ok: true, value: [{ kind: "issue", number: 11 }] }),
        );
        expect(await prQuality.evaluate(open, running, linked)).toEqual([]);
    });

    it("asks the linkedIssues resolver, once, about the pull request it was given", async () => {
        const asked: { query: string; input: unknown }[] = [];
        const recording: ResolverSource = async (query, input) => {
            asked.push({ query, input });
            return await Promise.resolve({ ok: true, value: [] } as never);
        };
        const open = pullRequest({});

        await prQuality.evaluate(open, running, handleFor(prQualityDeclaration, open, recording));

        expect(asked).toEqual([{ query: "linkedIssues", input: { item: ITEM } }]);
    });

    /** `claims.closed` is `false` rather than absent: an omitted claim is vacuous. */
    it("asks for one managed comment on the observed pull request, claiming it is open", async () => {
        const open = pullRequest({});
        expect(
            await prQuality.evaluate(
                open,
                running,
                handleFor(prQualityDeclaration, open, noneFound),
            ),
        ).toEqual([
            {
                capability: "prQuality",
                repository: REPOSITORY,
                item: ITEM,
                operation: "postManagedComment",
                desired: {
                    kind: "summary",
                    body: "This pull request does not reference an issue. Adding a closing reference keeps the issue and the pull request in step.",
                },
                claims: { meaningsPresent: [], meaningsAbsent: [], closed: false },
                cause: { cause: "pullRequestWithoutLinkedIssue", observedAt: OBSERVED_AT },
                explanation: {
                    capability: "prQuality",
                    summary: "Asked for a linked issue on this pull request.",
                    detail: [],
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
        const unreachable: ResolverSource = () => {
            throw new Error("a parked check asks nothing");
        };
        const open = pullRequest({});
        const parked = handleFor(prQualityDeclaration, open, unreachable);

        expect(
            await prQuality.evaluate(
                open,
                view({}),
                handleFor(prQualityDeclaration, open, unreachable),
            ),
        ).toEqual([]);
        expect(
            await prQuality.evaluate(
                open,
                view({ checks: { linkedIssues: { enabled: false } } }),
                parked,
            ),
        ).toEqual([]);
        expect(parked.explanations).toEqual([]);
    });

    /** The guide is where the design puts it: on the failure, and nowhere else. */
    it("ends the failing check with the guide the repository configured", async () => {
        const withGuide = view({
            checks: { linkedIssues: { enabled: true, guide: "https://example.test/linking" } },
        });
        const open = pullRequest({});
        const [intent] = await prQuality.evaluate(
            open,
            withGuide,
            handleFor(prQualityDeclaration, open, noneFound),
        );

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
