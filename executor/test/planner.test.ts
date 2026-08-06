import { describe, expect, it } from "vitest";
import {
    declareCapability,
    parseConfig,
    type AnyIntent,
    type RepositoryMode,
    type WriteContext,
} from "@hiero-hackers/automation-core";
import {
    planIntents,
    planningFindings,
    planningReport,
} from "../src/planner.js";

const REPOSITORY = { owner: "hiero-hackers", repo: "sandbox" } as const;
const OTHER_REPOSITORY = { owner: "hiero-hackers", repo: "elsewhere" } as const;
const NOW = new Date("2026-08-06T09:00:00.000Z");

const declaration = declareCapability({
    name: "fixture",
    triggers: [{ kind: "event", event: "issues" }],
    configKeys: [],
    observations: ["issueUpdated"],
    resolvers: [],
    intents: [
        {
            name: "postManagedComment",
            idempotencyClass: "nonIdempotent",
            requiredPermissions: ["issues:write"],
        },
        {
            name: "applyMappedLabel",
            idempotencyClass: "idempotent",
            requiredPermissions: ["issues:write"],
        },
    ],
    permissions: { repository: ["issues:write"], organization: [] },
    operationalNeeds: {
        schedule: false,
        durableState: "none",
        crossItemCoordination: false,
        externalDelivery: false,
    },
});

function config(mode: RepositoryMode = "active", revision = "rev-authoritative") {
    const parsed = parseConfig(
        {
            schemaVersion: 1,
            mode,
            capabilities: { fixture: { enabled: true } },
            mappings: { labels: { awaitingTriage: "status: triage", inProgress: "status: doing" } },
            principals: {},
        },
        { revision, knownCapabilities: ["fixture"] },
    );
    if (!parsed.ok) throw new Error(parsed.errors.map((error) => error.message).join("; "));
    return parsed.config;
}

const context = (over: Partial<WriteContext> = {}): WriteContext => ({
    installationGrants: ["issues:write"],
    killSwitchActive: false,
    observedMeanings: [],
    preconditionHolds: true,
    latestHumanChangeAt: null,
    ...over,
});

function commentIntent(over: Record<string, unknown> = {}): AnyIntent {
    return {
        capability: "fixture",
        repository: REPOSITORY,
        item: { kind: "issue", number: 1 },
        operation: "postManagedComment",
        actionClass: "humanFacingOutput",
        expected: { meaningsPresent: [], meaningsAbsent: [], closed: false },
        desired: { marker: "<!-- fixture -->", body: "hello" },
        cause: { cause: "test", observedAt: NOW },
        explanation: { capability: "fixture", summary: "Would comment.", detail: [] },
        idempotencyKey: "comment-1",
        ...over,
    } as AnyIntent;
}

function plan(
    intents: readonly AnyIntent[],
    mode: RepositoryMode = "active",
    revision = "rev-authoritative",
    contextFor: (intent: AnyIntent) => WriteContext = () => context(),
) {
    return planIntents(intents, {
        declaration,
        repository: REPOSITORY,
        config: config(mode, revision),
        contextFor,
        now: NOW,
    });
}

describe("planning findings are total across every refusal origin", () => {
    it("reports a normal plan as info", () => {
        const result = plan([commentIntent()]);
        expect(result.dispositions).toMatchObject([{ kind: "plan" }]);
        expect(planningFindings(result)).toMatchObject([{ severity: "info", code: "planned" }]);
    });

    it("reports a record-only dry-run disposition as notice", () => {
        const result = plan([commentIntent()], "dry-run");
        expect(result.dispositions).toMatchObject([{ kind: "record", code: "modeRecordsOnly" }]);
        expect(planningFindings(result)).toMatchObject([{ severity: "notice", code: "modeRecordsOnly" }]);
    });

    it("preserves benign and problem safety classifications from core", () => {
        const benign = plan([commentIntent()], "active", "rev", () =>
            context({ killSwitchActive: true }),
        );
        const problem = plan([commentIntent()], "active", "rev", () =>
            context({ installationGrants: [] }),
        );
        expect(benign.dispositions).toMatchObject([
            { kind: "refuse", origin: "safety", code: "killSwitch" },
        ]);
        expect(problem.dispositions).toMatchObject([
            { kind: "refuse", origin: "safety", code: "permissionMissing" },
        ]);
        expect(planningFindings(benign)[0]).toMatchObject({ severity: "notice" });
        expect(planningFindings(problem)[0]).toMatchObject({ severity: "problem" });
    });

    it.each([
        ["foreignCapability", commentIntent({ capability: "other" })],
        [
            "transitionNotOnMap",
            commentIntent({
                operation: "applyMappedLabel",
                actionClass: "reversibleStateChange",
                expected: { meaningsPresent: ["awaitingTriage"], meaningsAbsent: [], closed: false },
                desired: { meaning: "inProgress", cause: "intakeObserved" },
            }),
        ],
    ] as const)("reports the %s intent-screen refusal as a problem", (code, intent) => {
        const result = plan([intent]);
        expect(result.dispositions).toMatchObject([
            { kind: "refuse", origin: "intent-screen", code },
        ]);
        expect(planningFindings(result)).toMatchObject([{ severity: "problem", code }]);
    });

    it("reports duplicateIdempotencyKey as a planner problem", () => {
        const result = plan([commentIntent(), commentIntent({ item: { kind: "issue", number: 2 } })]);
        expect(result.dispositions[1]).toMatchObject({
            kind: "refuse",
            origin: "planner",
            code: "duplicateIdempotencyKey",
        });
        expect(planningFindings(result)[1]).toMatchObject({
            severity: "problem",
            code: "duplicateIdempotencyKey",
        });
    });

    it("returns only valid Finding severities while preserving disposition order", () => {
        const result = plan([
            commentIntent({ idempotencyKey: "shared" }),
            commentIntent({ capability: "other", idempotencyKey: "foreign" }),
            commentIntent({ item: { kind: "issue", number: 2 }, idempotencyKey: "shared" }),
        ]);
        expect(result.dispositions.map((disposition) =>
            disposition.kind === "refuse" ? `${disposition.origin}:${disposition.kind}` : disposition.kind,
        )).toEqual(["plan", "intent-screen:refuse", "planner:refuse"]);
        expect(planningFindings(result).every((finding) =>
            ["info", "notice", "problem"].includes(finding.severity),
        )).toBe(true);
    });
});

describe("planning report provenance is captured during planning", () => {
    it("uses the exact configuration mode and revision and cannot be substituted later", () => {
        const mutableRepository: { owner: string; repo: string } = { ...REPOSITORY };
        const result = planIntents([commentIntent()], {
            declaration,
            repository: mutableRepository,
            config: config("dry-run", "rev-from-config"),
            contextFor: () => context(),
            now: NOW,
        });
        mutableRepository.repo = "mutated-after-planning";
        const report = Reflect.apply(planningReport, undefined, [
            result,
            OTHER_REPOSITORY,
            "active",
            "substituted-revision",
        ]);
        expect(report).toMatchObject({
            repository: REPOSITORY,
            mode: "dry-run",
            revision: "rev-from-config",
        });
    });

    it("refuses the entire batch when any intent targets another repository", () => {
        const result = plan([
            commentIntent(),
            commentIntent({ repository: OTHER_REPOSITORY, idempotencyKey: "other" }),
        ]);
        expect(result.plans).toEqual([]);
        expect(result.dispositions).toHaveLength(2);
        expect(result.dispositions.every((disposition) =>
            disposition.kind === "refuse" &&
            disposition.origin === "planner" &&
            disposition.code === "mixedRepositoryBatch",
        )).toBe(true);
        const report = planningReport(result);
        expect(report.repository).toEqual(REPOSITORY);
        expect(report.findings.every((finding) => finding.subject.kind === "repository")).toBe(true);
        expect(report.findings.every((finding) =>
            finding.summary.includes("hiero-hackers/elsewhere"),
        )).toBe(true);
    });
});
