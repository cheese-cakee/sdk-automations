/**
 * The API origin as an option: where a client sends, what the gate admits, what the classifier reads.
 */

import { describe, expect, it } from "vitest";
import { admit } from "../../../src/adapter/client/admission.js";
import { GITHUB_API_ORIGIN, type GitHubRequest } from "../../../src/adapter/client/contract.js";
import { writeEndpointOf } from "../../../src/adapter/client/endpoints.js";
import { githubMintInstallationToken } from "../../../src/adapter/client/mint.js";
import { httpHarness, installationToken, responseScript, success } from "../harness.js";

const OTHER = "http://127.0.0.1:4010";
const ISSUE = "/repos/o/r/issues/1";
const GRAPHQL_TOKEN = {
    ...installationToken("graphql-token"),
    grants: ["issues:read", "issues:write", "pull_requests:read"],
} as const;
const GRAPHQL_BODY = JSON.stringify({
    operationName: "LinkedIssues",
    query: 'query LinkedIssues { repository(owner: "o", name: "r") { id } }',
});

const refusalOf = (outcome: ReturnType<typeof admit>): string | null =>
    outcome.ok
        ? null
        : outcome.refusal.failure.kind === "notSent"
          ? outcome.refusal.failure.reason
          : null;

describe("a client with another API origin", () => {
    it("sends a request spelled at GitHub's origin to the other", async () => {
        const { client, scripted } = httpHarness([success()], { apiOrigin: OTHER });

        const outcome = await client.request({
            url: `${GITHUB_API_ORIGIN}${ISSUE}`,
            method: "GET",
        });

        expect(outcome.ok).toBe(true);
        expect(scripted.calls.map(({ url }) => url)).toEqual([`${OTHER}${ISSUE}`]);
    });

    it.each([
        ["a read", { url: `${OTHER}${ISSUE}`, method: "GET" }, ISSUE],
        [
            "a write",
            {
                url: `${GITHUB_API_ORIGIN}${ISSUE}/labels`,
                method: "POST",
                body: JSON.stringify({ labels: ["x"] }),
                idempotency: "idempotent",
            },
            `${ISSUE}/labels`,
        ],
        [
            "the GraphQL query",
            { url: `${GITHUB_API_ORIGIN}/graphql`, method: "POST", body: GRAPHQL_BODY },
            "/graphql",
        ],
    ] as const)("sends %s to the other origin", async (_label, request, path) => {
        const { client, scripted } = httpHarness([success('{"data":{}}')], {
            apiOrigin: OTHER,
            outcomes: [{ ok: true, token: GRAPHQL_TOKEN }],
        });

        expect((await client.request(request)).ok).toBe(true);
        expect(scripted.calls.map(({ url }) => url)).toEqual([`${OTHER}${path}`]);
    });

    it("refuses a third origin before any token or send", async () => {
        const { client, scripted, tokens } = httpHarness([success()], { apiOrigin: OTHER });

        const outcome = await client.request({
            url: `https://evil.example${ISSUE}`,
            method: "GET",
        });

        expect(outcome).toMatchObject({
            ok: false,
            failure: { kind: "notSent", reason: "disallowedOrigin" },
        });
        expect(scripted.calls).toHaveLength(0);
        expect(tokens.calls()).toBe(0);
    });

    it("keeps GitHub's origin when none is named", async () => {
        const { client, scripted } = httpHarness([success()]);

        await client.request({ url: `${GITHUB_API_ORIGIN}${ISSUE}`, method: "GET" });

        expect(scripted.calls[0]!.url).toBe(`${GITHUB_API_ORIGIN}${ISSUE}`);
    });
});

describe("the admission gate with another origin", () => {
    const get = (origin: string): GitHubRequest => ({ url: `${origin}${ISSUE}`, method: "GET" });

    it("admits the named origin and refuses GitHub's", () => {
        expect(admit(get(OTHER), OTHER).ok).toBe(true);
        expect(refusalOf(admit(get(GITHUB_API_ORIGIN), OTHER))).toBe("disallowedOrigin");
    });

    it("admits GitHub's origin and refuses the other by default", () => {
        expect(admit(get(GITHUB_API_ORIGIN)).ok).toBe(true);
        expect(refusalOf(admit(get(OTHER)))).toBe("disallowedOrigin");
    });

    it("admits the GraphQL POST at the named origin alone", () => {
        const post = (origin: string): GitHubRequest => ({
            url: `${origin}/graphql`,
            method: "POST",
            body: GRAPHQL_BODY,
        });
        expect(admit(post(OTHER), OTHER).ok).toBe(true);
        expect(refusalOf(admit(post(GITHUB_API_ORIGIN), OTHER))).toBe("disallowedOrigin");
        expect(refusalOf(admit(post(OTHER)))).toBe("disallowedOrigin");
    });
});

describe("the endpoint classifier with another origin", () => {
    const url = new URL(`${OTHER}${ISSUE}/labels`);

    it("reads an endpoint under the origin it is given and stales keys there", () => {
        const matched = writeEndpointOf("POST", url, OTHER);
        expect(matched?.endpoint).toBe("addLabel");
        expect(matched?.invalidates).toEqual([
            `${OTHER}${ISSUE}`,
            `${OTHER}${ISSUE}/labels`,
            `${OTHER}${ISSUE}/timeline`,
        ]);
    });

    it("stales keys under GitHub's origin by default", () => {
        const matched = writeEndpointOf("POST", new URL(`${GITHUB_API_ORIGIN}${ISSUE}/labels`));
        expect(matched?.invalidates[0]).toBe(`${GITHUB_API_ORIGIN}${ISSUE}`);
    });
});

describe("the mint with another origin", () => {
    it("posts to the installation endpoint there", async () => {
        const scripted = responseScript([
            new Response(
                JSON.stringify({ token: "t", expires_at: "2026-08-26T13:00:00Z", permissions: {} }),
                { status: 201 },
            ),
        ]);
        const call = githubMintInstallationToken({ fetch: scripted.fetch, apiOrigin: OTHER });

        await call("assertion", { appId: "1", privateKeyPem: "unused", installationId: "789" });

        expect(scripted.calls[0]!.url).toBe(`${OTHER}/app/installations/789/access_tokens`);
    });
});
