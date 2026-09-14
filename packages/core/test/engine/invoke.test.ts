import { describe, expect, it } from "vitest";
import { declareCapability, RESOLVER_NAMES, spec, type ResolverName } from "../../src/index.js";
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

/** One well-formed answer per reader — every arm of `answerValue`'s switch. */
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
    /**
     * The runtime half of the switch's exhaustiveness. `answerValue` fails to
     * compile if a catalogue name has no arm; this fails if a name has an arm
     * no test ever exercises, which is the same gap seen from the other side.
     */
    it("has a well-formed answer here for every resolver in the catalogue", () => {
        expect([...new Set(VALID.map(([query]) => query))].sort()).toEqual(
            [...RESOLVER_NAMES].sort(),
        );
    });

    it.each(VALID)("accepts a valid %s answer", async (query, value) => {
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
        // Each list reader guards its own list-ness now that each is its own
        // arm, so an answer that is not a list is a case per reader.
        ["assigneesOf", "alice"],
        ["linkedIssues", "one"],
        ["commitAttestations", {}],
        ["openAssignments", 3],
        ["configAtHead", { touched: "yes" }],
        ["configAtHead", { ...proposed, revision: "" }],
        ["configAtHead", { ...proposed, revision: 1 }],
        ["configAtHead", { touched: true, revision: "sha256:abc", result: { ok: "yes" } }],
        ["configAtHead", { ...proposed, result: { ok: true, config: null } }],
        ["configAtHead", { ...rejected, result: { ok: false, errors: "none" } }],
        ["configAtHead", { ...rejected, result: { ok: false, errors: [{ message: "no" }] } }],
        [
            "configAtHead",
            { ...rejected, result: { ok: false, errors: [{ code: "x", message: 1 }] } },
        ],
        [
            "configAtHead",
            {
                ...rejected,
                result: { ok: false, errors: [{ code: "x", message: "no", path: 1 }] },
            },
        ],
        [
            "configAtHead",
            {
                ...rejected,
                result: {
                    ok: false,
                    errors: [{ code: "x", message: "no", path: null, line: 1.5 }],
                },
            },
        ],
        [
            "configAtHead",
            {
                ...rejected,
                result: {
                    ok: false,
                    errors: [{ code: "x", message: "no", path: null, line: "2" }],
                },
            },
        ],
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
        const handle = new EngineHandle(declaration, webhookIssue(), async () => answer as never);
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
