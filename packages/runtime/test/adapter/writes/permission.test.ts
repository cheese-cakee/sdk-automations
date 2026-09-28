/**
 * One grant stated twice: the permission core's operation declares, and the
 * grant the endpoint its request reaches carries (D62). The endpoint comes from
 * the request each verb builds, never from the verb's name (D129), and the
 * surface the adapter hands out is that same table composed (D210).
 * One invariant per `it` (D89).
 */

import {
    INTENT_OPERATIONS,
    type IntentOperation,
    type ItemRef,
    type PermissionGrant,
    type WriteVerbs,
} from "@hiero-hackers/automation-core";
import { describe, expect, it } from "vitest";
import {
    CONFIRMED_WRITE_ENDPOINTS,
    writeEndpointOf,
    type WriteEndpoint,
} from "../../../src/adapter/client/endpoints.js";
import {
    REQUESTS,
    WRITE_VERBS,
    writeVerbsOf,
    type BuiltWrite,
} from "../../../src/adapter/writes/requests.js";
import { TEST_ITEM as ITEM, TEST_REPOSITORY as REPOSITORY } from "../harness.js";

/** The close names the pull surface, whose grant is not the issue surface's. */
const PULL: ItemRef = { kind: "pullRequest", number: 205 };

/** One built request per verb, and the operation that verb serves; the arguments are not the subject. */
const ROWS: { readonly [V in keyof WriteVerbs]: readonly [BuiltWrite, IntentOperation] } = {
    createLabel: [
        REQUESTS.createLabel(REPOSITORY, "status: stale", "5319e7", "w"),
        "applyMappedLabel",
    ],
    addLabel: [REQUESTS.addLabel(REPOSITORY, ITEM, "status: stale"), "applyMappedLabel"],
    removeLabel: [REQUESTS.removeLabel(REPOSITORY, ITEM, "status: stale"), "applyMappedLabel"],
    createComment: [REQUESTS.createComment(REPOSITORY, ITEM, "hello"), "postManagedComment"],
    updateComment: [REQUESTS.updateComment(REPOSITORY, 7788, "again"), "postManagedComment"],
    closePullRequest: [REQUESTS.closePullRequest(REPOSITORY, PULL), "closePullRequest"],
    releaseAssignment: [REQUESTS.releaseAssignment(REPOSITORY, ITEM, "alice"), "releaseAssignment"],
    lockIssue: [REQUESTS.lockIssue(REPOSITORY, ITEM), "lockIssue"],
    unlockIssue: [REQUESTS.unlockIssue(REPOSITORY, ITEM), "unlockIssue"],
};

/** One request a verb built, and the endpoint the client matches it as. */
interface Reach {
    readonly verb: keyof WriteVerbs;
    readonly operation: IntentOperation;
    readonly request: string;
    readonly endpoint: WriteEndpoint | null;
}

const reaches = (): Reach[] =>
    (Object.entries(ROWS) as [keyof WriteVerbs, (typeof ROWS)[keyof WriteVerbs]][]).map(
        ([verb, [built, operation]]) => ({
            verb,
            operation,
            request: `${built.request.method} ${built.request.url}`,
            endpoint:
                writeEndpointOf(built.request.method, new URL(built.request.url))?.endpoint ?? null,
        }),
    );

/** The grants the endpoint table states, the side under test. */
const stated = (endpoint: WriteEndpoint): PermissionGrant =>
    CONFIRMED_WRITE_ENDPOINTS[endpoint].grant;

/** Where an endpoint's grant and its operation's permission disagree. */
function disagreements(
    rows: readonly Reach[],
    grantOf: (endpoint: WriteEndpoint) => PermissionGrant,
): string[] {
    return rows
        .filter(
            (row) =>
                row.endpoint !== null &&
                grantOf(row.endpoint) !== INTENT_OPERATIONS[row.operation].permission,
        )
        .map((row) => `${row.operation} → ${String(row.endpoint)}`);
}

describe("a write verb and its endpoint state one permission", () => {
    it("matches every request the table builds to the endpoint of the same name", () => {
        expect(reaches().map((row) => [row.verb, row.endpoint])).toEqual(
            WRITE_VERBS.map((verb) => [verb, verb]),
        );
    });

    it("reaches every confirmed write endpoint", () => {
        expect([...new Set(reaches().map((row) => row.endpoint))].sort()).toEqual(
            Object.keys(CONFIRMED_WRITE_ENDPOINTS).sort(),
        );
    });

    it("carries a body exactly where its shape says one is carried", () => {
        for (const [verb, [built]] of Object.entries(ROWS)) {
            const shape = CONFIRMED_WRITE_ENDPOINTS[verb as WriteEndpoint];
            expect([verb, built.request.body === undefined]).toEqual([verb, shape.body === "none"]);
        }
    });

    it("gives each endpoint the permission its operation states (D62)", () => {
        expect(disagreements(reaches(), stated)).toEqual([]);
    });

    it("catches an endpoint whose grant drifted from its operation's", () => {
        const drifted = (endpoint: WriteEndpoint): PermissionGrant =>
            endpoint === "closePullRequest" ? "issues:write" : stated(endpoint);

        expect(disagreements(reaches(), drifted)).toEqual(["closePullRequest → closePullRequest"]);
    });
});

describe("the write surface is the table's verbs", () => {
    it("hands out one method per row, sending what the row builds", async () => {
        const sent: string[] = [];
        const verbs = writeVerbsOf(REPOSITORY, (request) => {
            sent.push(`${request.method} ${request.url}`);
            return Promise.resolve({ outcome: "applied" });
        });
        expect(Object.keys(verbs).sort()).toEqual([...WRITE_VERBS].sort());
        await verbs.removeLabel(ITEM, "status: stale");
        await verbs.lockIssue(ITEM);
        expect(sent).toEqual(
            [ROWS.removeLabel[0], ROWS.lockIssue[0]].map(
                (b) => `${b.request.method} ${b.request.url}`,
            ),
        );
    });
});
