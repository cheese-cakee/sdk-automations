/**
 * The live mint: one POST, assertion-authenticated, every failure a
 * classified outcome. Response bodies are SYNTHETIC, shaped from GitHub's
 * documented access-token format, not recorded traffic.
 */

import { describe, expect, it } from "vitest";
import { githubMintInstallationToken } from "../src/mint.js";
import type { AppCredentials } from "../src/jwt.js";
import { failure, responseScript, success } from "./harness.js";

const CREDENTIALS: AppCredentials = {
    appId: "123456",
    privateKeyPem: "unused by the mint call itself",
    installationId: "789",
};

const MINTED = JSON.stringify({
    token: "ghs_minted",
    expires_at: "2026-08-26T13:00:00Z",
    permissions: { issues: "write", contents: "read" },
});

function mint(steps: Parameters<typeof responseScript>[0]) {
    const scripted = responseScript(steps);
    const call = githubMintInstallationToken({
        fetch: scripted.fetch,
        timeoutSignal: () => new AbortController().signal,
    });
    return { call, scripted };
}

describe("the live mint", () => {
    it("posts the assertion to the installation's endpoint and reads the token", async () => {
        const { call, scripted } = mint([new Response(MINTED, { status: 201 })]);

        expect(await call("signed-assertion", CREDENTIALS)).toEqual({
            ok: true,
            token: {
                value: "ghs_minted",
                expiresAt: new Date("2026-08-26T13:00:00Z"),
                grants: ["issues:write", "contents:read"],
            },
        });
        expect(scripted.calls).toHaveLength(1);
        expect(scripted.calls[0]!.url).toBe(
            "https://api.github.com/app/installations/789/access_tokens",
        );
        const init = scripted.calls[0]!.init;
        expect(init.method).toBe("POST");
        expect(init.redirect).toBe("manual");
        const headers = new Headers(init.headers);
        expect(headers.get("accept")).toBe("application/vnd.github+json");
        expect(headers.get("authorization")).toBe("Bearer signed-assertion");
        expect(headers.get("x-github-api-version")).toBe("2026-03-10");
        expect(headers.get("user-agent")).toBe("hiero-hackers-sdk-automations");
        expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it("answers an empty grant list for a mint response without permissions", async () => {
        const { call } = mint([
            new Response(JSON.stringify({ token: "t", expires_at: "2026-08-26T13:00:00Z" }), {
                status: 201,
            }),
        ]);

        const outcome = await call("a", CREDENTIALS);
        expect(outcome.ok && outcome.token.grants).toEqual([]);
    });

    it("classifies a rejected mint instead of throwing", async () => {
        const { call } = mint([failure(401, "Bad credentials")]);

        expect(await call("a", CREDENTIALS)).toEqual({
            ok: false,
            failure: { kind: "badCredentials" },
        });
    });

    it("keeps a rejected mint with an unreadable body as transient", async () => {
        const { call } = mint([
            new Response(
                new ReadableStream({
                    pull(controller) {
                        controller.error(new Error("body interrupted"));
                    },
                }),
                { status: 401 },
            ),
        ]);

        expect(await call("a", CREDENTIALS)).toEqual({
            ok: false,
            failure: { kind: "transient" },
        });
    });

    it("refuses to follow a redirect and names it", async () => {
        const { call } = mint([
            new Response(null, {
                status: 302,
                headers: { location: "https://attacker.example/steal" },
            }),
        ]);

        const outcome = await call("a", CREDENTIALS);
        expect(outcome.ok).toBe(false);
        if (!outcome.ok) expect(outcome.failure.kind).toBe("redirected");
    });

    it("contains a transport failure as transient", async () => {
        const { call } = mint([new Error("socket closed")]);

        expect(await call("a", CREDENTIALS)).toEqual({
            ok: false,
            failure: { kind: "transient" },
        });
    });

    it.each([
        ["unparsable JSON", success("not json", undefined)],
        ["a non-object body", new Response('"token"', { status: 201 })],
        ["an array body", new Response("[]", { status: 201 })],
        [
            "a missing token field",
            new Response('{"expires_at":"2026-08-26T13:00:00Z"}', { status: 201 }),
        ],
        ["a missing expiry", new Response('{"token":"t"}', { status: 201 })],
        [
            "an unreadable expiry",
            new Response('{"token":"t","expires_at":"later"}', { status: 201 }),
        ],
        ["a numeric expiry", new Response('{"token":"t","expires_at":123}', { status: 201 })],
    ])("treats %s as transient, never a token", async (_label, response) => {
        const { call } = mint([response]);

        expect(await call("a", CREDENTIALS)).toEqual({
            ok: false,
            failure: { kind: "transient" },
        });
    });

    it("answers an empty grant list for a null permissions field", async () => {
        const { call } = mint([
            new Response(
                JSON.stringify({
                    token: "t",
                    expires_at: "2026-08-26T13:00:00Z",
                    permissions: null,
                }),
                { status: 201 },
            ),
        ]);

        const outcome = await call("a", CREDENTIALS);
        expect(outcome).toEqual({
            ok: true,
            token: { value: "t", expiresAt: new Date("2026-08-26T13:00:00Z"), grants: [] },
        });
    });

    it("bounds a broken response stream to a transient failure", async () => {
        const { call } = mint([
            new Response(
                new ReadableStream({
                    pull(controller) {
                        controller.error(new Error("body interrupted"));
                    },
                }),
                { status: 201 },
            ),
        ]);

        expect(await call("a", CREDENTIALS)).toEqual({
            ok: false,
            failure: { kind: "transient" },
        });
    });
});
