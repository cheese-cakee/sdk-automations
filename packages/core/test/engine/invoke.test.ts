import { describe, expect, it } from "vitest";
import { declareCapability, type ResolverName } from "../../src/index.js";
import { EngineHandle } from "../../src/engine/invoke.js";

const declaration = declareCapability({
    name: "fixture",
    triggers: [{ kind: "event", event: "issues" }],
    configKeys: [],
    requiredMappings: {},
    facts: ["issue"],
    needs: [],
    resolvers: [
        "linkedIssues",
        "isAutomationActor",
        "commitAttestations",
        "mergeability",
        "assigneesOf",
        "openAssignments",
    ],
    intents: [],
    operationalNeeds: {
        schedule: false,
        durableState: "none",
        crossItemCoordination: false,
        externalDelivery: false,
    },
});

const resolve = async (query: ResolverName, answer: unknown) =>
    await new EngineHandle(declaration, async () => answer as never).resolve(query, {});

const commit = {
    sha: "abc",
    summary: "change",
    signedOff: true,
    verified: false,
    merge: false,
};

const assignment = {
    item: { kind: "pullRequest", number: 2 },
    meanings: ["ready"],
};

describe("resolver answers", () => {
    it.each([
        ["isAutomationActor", true],
        ["mergeability", false],
        ["assigneesOf", ["alice"]],
        ["linkedIssues", [{ kind: "issue", number: 1 }]],
        ["commitAttestations", [commit]],
        ["openAssignments", [assignment]],
    ] as const)("accepts a valid %s answer", async (query, value) => {
        await expect(resolve(query, { ok: true, value })).resolves.toEqual({ ok: true, value });
    });

    it.each([
        ["isAutomationActor", "yes"],
        ["mergeability", null],
        ["assigneesOf", new Array(1)],
        ["assigneesOf", ["alice", 1]],
        ["linkedIssues", [{ kind: "issue", number: 0 }]],
        ["linkedIssues", [{ kind: "issue", number: "1" }]],
        ["linkedIssues", [{ kind: "discussion", number: 1 }]],
        ["linkedIssues", [{ kind: "issue", number: 1 }, null]],
        ["commitAttestations", [{ sha: "abc" }]],
        ["commitAttestations", [commit, { ...commit, sha: 1 }]],
        ["commitAttestations", [commit, { ...commit, summary: 1 }]],
        ["commitAttestations", [commit, { ...commit, signedOff: "yes" }]],
        ["commitAttestations", [commit, { ...commit, verified: "yes" }]],
        ["commitAttestations", [commit, { ...commit, merge: "no" }]],
        ["openAssignments", [{ item: { kind: "issue", number: 1 }, meanings: ["unknown"] }]],
        ["openAssignments", [{ item: null, meanings: [] }]],
        ["openAssignments", [assignment, { ...assignment, meanings: ["unknown"] }]],
        ["openAssignments", [{ ...assignment, meanings: ["ready", "unknown"] }]],
        ["openAssignments", [{ ...assignment, meanings: ["ready", 1] }]],
        ["assigneesOf", "alice"],
    ] as const)("rejects a malformed %s answer", async (query, value) => {
        await expect(resolve(query, { ok: true, value })).resolves.toMatchObject({
            ok: false,
            reason: "unavailable",
        });
    });

    it.each(["noPermission", "rateLimited", "unavailable", "notConfigured"] as const)(
        "accepts the %s failure reason",
        async (reason) => {
            await expect(
                resolve("linkedIssues", { ok: false, reason, detail: "later" }),
            ).resolves.toEqual({
                ok: false,
                reason,
                detail: "later",
            });
        },
    );

    it.each([
        { ok: false, reason: "other", detail: "no" },
        { reason: "unavailable", detail: "no" },
        { ok: false, reason: "unavailable" },
        { ok: false, reason: "unavailable", detail: 1 },
        null,
    ])("rejects a malformed failure envelope", async (answer) => {
        const handle = new EngineHandle(declaration, async () => answer as never);
        await expect(handle.resolve("linkedIssues", {})).resolves.toEqual({
            ok: false,
            reason: "unavailable",
            detail: "the resolver source returned a malformed answer",
        });
        expect(handle.failures).toEqual([
            "linkedIssues: the resolver source returned a malformed answer",
        ]);
    });

    it("contains hostile answer property access", async () => {
        const answer = new Proxy(
            {},
            {
                getOwnPropertyDescriptor: () => {
                    throw new Error("no");
                },
            },
        );
        await expect(resolve("linkedIssues", answer)).resolves.toMatchObject({
            ok: false,
            reason: "unavailable",
        });
    });
});
