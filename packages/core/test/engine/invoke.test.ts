import { describe, expect, it } from "vitest";
import { declareCapability, spec, type ResolverName } from "../../src/index.js";
import { EngineHandle } from "../../src/engine/invoke.js";
import { webhookIssue } from "../../src/author/testing.js";

const declaration = declareCapability({
    name: "fixture",
    triggers: [{ kind: "event", event: "issues" }],
    settings: spec({}),
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
        "configAtHead",
    ],
    intents: [],
});

const resolve = async (query: ResolverName, answer: unknown) =>
    await new EngineHandle(declaration, webhookIssue(), async () => answer as never).resolve(
        query,
        {},
    );

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

/** The shape `configAtHead` answers with when the pull request changed the file. */
const proposed = {
    touched: true,
    revision: "sha256:abc",
    result: { ok: true, config: { mode: "observe" } },
};

const rejected = {
    touched: true,
    revision: "sha256:abc",
    result: {
        ok: false,
        errors: [{ code: "modeInvalid", message: "no", path: "mode", line: 2 }],
    },
};

/** One answer per resolver, passed through untouched (D209). */
const VALID = [
    ["isAutomationActor", true],
    ["mergeability", false],
    ["assigneesOf", ["alice"]],
    ["linkedIssues", [{ kind: "issue", number: 1 }]],
    ["commitAttestations", [commit]],
    ["openAssignments", [assignment]],
    ["configAtHead", { touched: false }],
    ["configAtHead", proposed],
    ["configAtHead", rejected],
    // A path the parser could not place, and an error with no path at all.
    [
        "configAtHead",
        {
            touched: true,
            revision: "sha256:abc",
            result: {
                ok: false,
                errors: [{ code: "documentUnparseable", message: "no", path: null }],
            },
        },
    ],
] as const satisfies readonly (readonly [ResolverName, unknown])[];

describe("resolver answers", () => {
    it.each(VALID)("passes a %s answer through", async (query, value) => {
        await expect(resolve(query, { ok: true, value })).resolves.toEqual({ ok: true, value });
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
});
