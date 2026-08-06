import { describe, expect, expectTypeOf, it } from "vitest";
import {
    declareCapability,
    parseConfig,
    type AnyIntent,
    type Intent,
    type RepositoryMode,
    type WriteContext,
} from "@hiero-hackers/automation-core";
import {
    planIntents,
    planningFindings,
    planningReport,
} from "../src/planner.js";
import { commandIdentity, type AdapterCommand } from "../src/recovery.js";

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
        {
            name: "unassign",
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
            mappings: {
                labels: {
                    awaitingTriage: "status: triage",
                    ready: "status: ready",
                    inProgress: "status: doing",
                },
            },
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

function labelIntent(): Intent<"applyMappedLabel"> {
    return {
        capability: "fixture",
        repository: REPOSITORY,
        item: { kind: "issue", number: 17 },
        operation: "applyMappedLabel",
        actionClass: "reversibleStateChange",
        expected: {
            meaningsPresent: ["awaitingTriage"],
            meaningsAbsent: ["ready", "blocked"],
            closed: false,
        },
        desired: { meaning: "ready", cause: "triageCompleted" },
        cause: { cause: "triage completed", observedAt: NOW },
        explanation: {
            capability: "fixture",
            summary: "Would mark ready.",
            detail: [],
        },
        idempotencyKey: "label-17",
    };
}

function unassignIntent(): Intent<"unassign"> {
    return {
        capability: "fixture",
        repository: REPOSITORY,
        item: { kind: "pullRequest", number: 23 },
        operation: "unassign",
        actionClass: "reversibleStateChange",
        expected: {
            meaningsPresent: ["needsRevision"],
            meaningsAbsent: ["blocked"],
            closed: null,
        },
        desired: { login: "Exact-Login" },
        cause: { cause: "maintainer request", observedAt: NOW },
        explanation: {
            capability: "fixture",
            summary: "Would unassign.",
            detail: [],
        },
        idempotencyKey: "unassign-23",
    };
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

describe("typed adapter command contract", () => {
    it("translates every current operation without losing adapter inputs", () => {
        const comment = commentIntent({
            item: { kind: "issue", number: 11 },
            expected: {
                meaningsPresent: ["awaitingTriage"],
                meaningsAbsent: ["blocked"],
                closed: false,
            },
            desired: {
                marker: "<!-- exact-marker -->",
                body: "Exact managed body",
            },
        });
        const result = plan([comment, labelIntent(), unassignIntent()]);
        const commands = result.plans.map(
            (effectPlan) => effectPlan.calls[0]!.command,
        );

        expect(commands).toEqual([
            expect.objectContaining({
                operation: "postManagedComment",
                repository: REPOSITORY,
                item: { kind: "issue", number: 11 },
                configurationRevision: "rev-authoritative",
                expected: {
                    meaningsPresent: ["awaitingTriage"],
                    meaningsAbsent: ["blocked"],
                    closed: false,
                },
                desired: {
                    marker: "<!-- exact-marker -->",
                    body: "Exact managed body",
                },
                readBack: { kind: "managedCommentMarker" },
            }),
            expect.objectContaining({
                operation: "applyMappedLabel",
                repository: REPOSITORY,
                item: { kind: "issue", number: 17 },
                desired: { meaning: "ready", label: "status: ready" },
                readBack: { kind: "mappedLabel" },
            }),
            expect.objectContaining({
                operation: "unassign",
                repository: REPOSITORY,
                item: { kind: "pullRequest", number: 23 },
                desired: { login: "Exact-Login" },
                readBack: { kind: "assigneeAbsent" },
            }),
        ]);
        expect(commands[1]!.expected).toEqual(labelIntent().expected);
        expect(commands[2]!.expected).toEqual(unassignIntent().expected);
        expect(commands[1]!.configuredLabels).toEqual([
            { meaning: "awaitingTriage", label: "status: triage" },
            { meaning: "ready", label: "status: ready" },
            { meaning: "inProgress", label: "status: doing" },
        ]);
    });

    it("takes revision and retry class only from platform-owned configuration and catalogue", () => {
        const result = plan(
            [commentIntent(), labelIntent(), unassignIntent()],
            "active",
            "reviewed-config-sha",
        );
        expect(result.plans.map(({ revision }) => revision)).toEqual([
            "reviewed-config-sha",
            "reviewed-config-sha",
            "reviewed-config-sha",
        ]);
        expect(
            result.plans.map(({ calls }) => ({
                revision: calls[0]!.command.configurationRevision,
                idempotencyClass: calls[0]!.idempotencyClass,
            })),
        ).toEqual([
            { revision: "reviewed-config-sha", idempotencyClass: "nonIdempotent" },
            { revision: "reviewed-config-sha", idempotencyClass: "idempotent" },
            { revision: "reviewed-config-sha", idempotencyClass: "idempotent" },
        ]);
    });

    it("round-trips commands through JSON as equivalent plain data", () => {
        const commands = plan([
            commentIntent(),
            labelIntent(),
            unassignIntent(),
        ]).plans.map(({ calls }) => calls[0]!.command);
        expect(JSON.parse(JSON.stringify(commands))).toEqual(commands);
        expect(
            commands.every(
                (command) => Object.getPrototypeOf(command) === Object.prototype,
            ),
        ).toBe(true);
    });

    it("derives command identity independently of object-key insertion order", () => {
        const command = plan([commentIntent()]).plans[0]!.calls[0]!.command;
        if (command.operation !== "postManagedComment") {
            throw new Error("comment intent must produce a comment command");
        }
        const reordered = {
            readBack: command.readBack,
            desired: command.desired,
            configuredLabels: command.configuredLabels.map(({ label, meaning }) => ({
                label,
                meaning,
            })),
            expected: {
                closed: command.expected.closed,
                meaningsAbsent: command.expected.meaningsAbsent,
                meaningsPresent: command.expected.meaningsPresent,
            },
            configurationRevision: command.configurationRevision,
            item: { number: command.item.number, kind: command.item.kind },
            repository: { repo: command.repository.repo, owner: command.repository.owner },
            operation: command.operation,
        } satisfies AdapterCommand;

        expect(commandIdentity(reordered)).toBe(commandIdentity(command));
    });

    it("refuses a mapped-label command when the desired meaning has no configured label", () => {
        const parsed = parseConfig(
            {
                schemaVersion: 1,
                mode: "active",
                capabilities: { fixture: { enabled: true } },
                mappings: { labels: { awaitingTriage: "status: triage" } },
                principals: {},
            },
            { revision: "rev", knownCapabilities: ["fixture"] },
        );
        if (!parsed.ok) throw new Error("test configuration must parse");

        const result = planIntents([labelIntent()], {
            declaration,
            repository: REPOSITORY,
            config: parsed.config,
            contextFor: () => context(),
            now: NOW,
        });
        expect(result.plans).toEqual([]);
        expect(result.dispositions).toMatchObject([
            { kind: "refuse", origin: "planner", code: "mappedLabelMissing" },
        ]);
    });

    it("makes an operation with another operation's payload structurally impossible", () => {
        type MismatchedPayload = {
            readonly operation: "postManagedComment";
            readonly desired: { readonly login: string };
        };
        type IsAssignable = MismatchedPayload extends AdapterCommand ? true : false;
        expectTypeOf<IsAssignable>().toEqualTypeOf<false>();
    });

    it.each(["dry-run", "observe"] as const)(
        "%s mode produces no executable plans",
        (mode) => {
            expect(plan([commentIntent()], mode).plans).toEqual([]);
        },
    );
});
