import { describe, expect, it } from "vitest";
import {
    admitPullRequest,
    decideLinkedIssue,
    type LinkedIssueObservation,
} from "../src/linked-issue.js";
import { parseConfigDocument, type RepositoryMode } from "../src/config.js";

const repository = { owner: "Hiero", repo: "SDK" };
const input = { repository, number: 42, state: "open" as const };
const config = (mode: RepositoryMode, enabled = true) => ({ mode, enabled });

describe("linked-issue decisions", () => {
    it.each([
        ["observe", "present", "satisfied", []],
        ["dry-run", "present", "satisfied", []],
        ["observe", "absent", "observedAbsent", []],
        [
            "dry-run",
            "absent",
            "advisoryDesired",
            [
                "This pull request is not linked to an issue. Add a closing reference such as `Closes #123`.",
            ],
        ],
        ["observe", "unknown", "unknown", []],
        ["dry-run", "unknown", "unknown", []],
    ] as const)("%s with %s produces %s", (mode, observation, outcome, desiredAdvisories) => {
        const observed: LinkedIssueObservation =
            observation === "unknown"
                ? { outcome: observation, reason: "reader unavailable" }
                : { outcome: observation };
        expect(decideLinkedIssue(config(mode), input, observed)).toMatchObject({
            outcome,
            observation: observed,
            desiredAdvisories,
        });
    });
    it("does not evaluate a disabled capability", () => {
        expect(decideLinkedIssue(config("disabled"), input, { outcome: "absent" })).toMatchObject({
            outcome: "disabled",
            observation: null,
            desiredAdvisories: [],
        });
    });
    it("keeps the canonical capability and pull-request identity", () => {
        expect(decideLinkedIssue(config("observe"), input, { outcome: "present" })).toEqual({
            capability: "linkedIssue",
            mode: "observe",
            repository,
            pullRequest: 42,
            outcome: "satisfied",
            observation: { outcome: "present" },
            desiredAdvisories: [],
        });
    });
});

describe("strict linkedIssue configuration", () => {
    const valid = (extra = "") =>
        `schemaVersion: 1\nmode: dry-run\ncapabilities:\n  linkedIssue:\n    enabled: true\n${extra}`;
    it("accepts only the minimal capability", () =>
        expect(parseConfigDocument(valid())).toEqual({
            ok: true,
            config: { mode: "dry-run", enabled: true },
        }));
    it("accepts an explicitly empty settings mapping", () =>
        expect(parseConfigDocument(valid("    settings: {}\n"))).toEqual({
            ok: true,
            config: { mode: "dry-run", enabled: true },
        }));
    it.each([
        ["unknown top-level", valid("other: true\n")],
        ["unknown capability", valid("  other: true\n")],
        ["unknown setting", valid("    settings:\n      wording: custom\n")],
        ["non-mapping settings", valid("    settings: false\n")],
        [
            "disabled non-empty settings",
            valid().replace("enabled: true", "enabled: false\n    settings:\n      future: true"),
        ],
    ])("rejects %s", (_name, text) => expect(parseConfigDocument(text).ok).toBe(false));
    it.each([
        valid("    settings:\n      wording: custom\n"),
        valid("    settings: false\n"),
        valid().replace("enabled: true", "enabled: false\n    settings:\n      future: true"),
    ])("reports the exact settings refusal", (text) =>
        expect(parseConfigDocument(text)).toEqual({
            ok: false,
            errors: [
                {
                    code: "invalidConfiguration",
                    path: "capabilities.linkedIssue.settings",
                    message: "settings must be an empty mapping",
                },
            ],
        }),
    );
    it.each([
        [
            "schemaVersion: 2\nmode: dry-run\ncapabilities:\n  linkedIssue:\n    enabled: true\n",
            "schemaVersion",
            "schemaVersion must be 1",
        ],
        [
            "schemaVersion: 1\nmode: loud\ncapabilities:\n  linkedIssue:\n    enabled: true\n",
            "mode",
            "mode must be disabled, observe, dry-run, or active",
        ],
        [
            "schemaVersion: 1\nmode: dry-run\ncapabilities: []\n",
            "capabilities",
            "capabilities must be a mapping",
        ],
        [
            "schemaVersion: 1\nmode: dry-run\ncapabilities:\n  linkedIssue: false\n",
            "capabilities.linkedIssue",
            "linkedIssue must be a mapping",
        ],
        [
            "schemaVersion: 1\nmode: dry-run\ncapabilities:\n  linkedIssue:\n    enabled: yes\n",
            "capabilities.linkedIssue.enabled",
            "enabled must be boolean",
        ],
    ])("reports one semantic error at %s", (text, path, message) => {
        expect(parseConfigDocument(text)).toEqual({
            ok: false,
            errors: [{ code: "invalidConfiguration", path, message }],
        });
    });
    it.each([
        [valid("other: true\n"), "other", 'unknown key "other"'],
        [valid("  other: true\n"), "capabilities.other", 'unknown key "capabilities.other"'],
        [
            valid("    future: true\n"),
            "capabilities.linkedIssue.future",
            'unknown key "capabilities.linkedIssue.future"',
        ],
    ])("reports the exact unknown key", (text, path, message) => {
        expect(parseConfigDocument(text)).toEqual({
            ok: false,
            errors: [{ code: "unknownKey", path, message }],
        });
    });
    it("keeps an empty document inert", () => {
        expect(parseConfigDocument(" \n")).toEqual({
            ok: true,
            config: { mode: "observe", enabled: false },
        });
    });
    it("rejects a non-mapping document", () => {
        expect(parseConfigDocument("[]\n")).toEqual({
            ok: false,
            errors: [
                {
                    code: "invalidConfiguration",
                    path: null,
                    message: "configuration must be a mapping",
                },
            ],
        });
    });
    it.each([
        "mode: [unclosed\n",
        "schemaVersion: 1\nmode: observe\nmode: dry-run\ncapabilities: {}\n",
    ])("rejects malformed or duplicate YAML", (text) => {
        const result = parseConfigDocument(text);
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error("expected parse rejection");
        expect(result.errors[0]).toMatchObject({ code: "documentUnparseable", path: null });
    });
});

describe("pull-request admission", () => {
    const payload = (overrides: Record<string, unknown> = {}) => ({
        action: "opened",
        number: 42,
        repository: { name: "sdk", owner: { login: "hiero" } },
        pull_request: { number: 42, state: "open", closed_at: null },
        ...overrides,
    });
    it("accepts supported actions and GitHub-style case-insensitive names", () =>
        expect(admitPullRequest("pull_request", payload(), repository).kind).toBe("accepted"));
    it.each(["opened", "edited", "reopened"])("accepts %s", (action) =>
        expect(admitPullRequest("pull_request", payload({ action }), repository).kind).toBe(
            "accepted",
        ),
    );
    it("ignores unsupported events and actions", () => {
        expect(admitPullRequest("issues", payload(), repository)).toEqual({
            kind: "ignored",
            reason: 'unsupported event "issues"',
        });
        expect(admitPullRequest("pull_request", payload({ action: "closed" }), repository)).toEqual(
            {
                kind: "ignored",
                reason: 'unsupported pull_request action "closed"',
            },
        );
    });
    it("refuses repository mismatches", () =>
        expect(
            admitPullRequest(
                "pull_request",
                payload({ repository: { name: "other", owner: { login: "hiero" } } }),
                repository,
            ),
        ).toEqual({
            kind: "refused",
            reason: "payload repository does not match the configured repository",
        }));
    it("refuses closed and inconsistent pull requests", () => {
        expect(
            admitPullRequest(
                "pull_request",
                payload({ pull_request: { number: 42, state: "closed", closed_at: "now" } }),
                repository,
            ).kind,
        ).toBe("refused");
        expect(
            admitPullRequest(
                "pull_request",
                payload({ pull_request: { number: 41, state: "open", closed_at: null } }),
                repository,
            ).kind,
        ).toBe("refused");
    });
    it.each([
        [null, "payload is not an object"],
        [[], "payload is not an object"],
        [{ action: "opened" }, "payload repository identity is malformed"],
        [
            payload({ repository: { name: "sdk", owner: {} } }),
            "payload repository identity is malformed",
        ],
        [payload({ pull_request: undefined }), "pull request number is malformed or inconsistent"],
        [
            payload({ number: 0, pull_request: { number: 0, state: "open", closed_at: null } }),
            "pull request number is malformed or inconsistent",
        ],
        [
            payload({ number: 1.5, pull_request: { number: 1.5, state: "open", closed_at: null } }),
            "pull request number is malformed or inconsistent",
        ],
    ])("refuses malformed input", (candidate, reason) => {
        expect(admitPullRequest("pull_request", candidate, repository)).toEqual({
            kind: "refused",
            reason,
        });
    });
    it.each([
        [payload({ pull_request: { number: 42, state: "closed", closed_at: null } })],
        [payload({ pull_request: { number: 42, state: "open", closed_at: "now" } })],
    ])("refuses every inconsistent closed state", (candidate) => {
        expect(admitPullRequest("pull_request", candidate, repository)).toEqual({
            kind: "refused",
            reason: "only open pull requests may request an advisory",
        });
    });
    it("returns the canonical admitted input", () => {
        expect(admitPullRequest("pull_request", payload(), repository)).toEqual({
            kind: "accepted",
            input: { repository, number: 42, state: "open" },
        });
    });
});
