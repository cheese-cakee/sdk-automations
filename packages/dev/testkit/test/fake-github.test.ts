/** The fake GitHub, asked over HTTP: its routes, headers, validators and switches. */

import { afterEach, describe, expect, it } from "vitest";
import { startFakeGitHub, type FakeGitHub } from "../src/index.js";

const NOW = new Date("2026-09-15T10:00:00.000Z");
const CONFIG = "version: 1\n";
const CONTENTS = "/repos/o/r/contents/sdk-automations.yml";

let fake: FakeGitHub | undefined;

async function started(): Promise<FakeGitHub> {
    fake = await startFakeGitHub({ now: () => NOW, config: () => CONFIG });
    return fake;
}

afterEach(async () => {
    await fake?.close();
    fake = undefined;
});

describe("the fake GitHub answers reads", () => {
    it("serves the config route with rate-limit headers and an ETag", async () => {
        const github = await started();
        const response = await fetch(`${github.origin}${CONTENTS}`);
        const body = (await response.json()) as { content: string };
        expect(response.status).toBe(200);
        expect(Buffer.from(body.content, "base64").toString()).toBe(CONFIG);
        expect(response.headers.get("x-ratelimit-limit")).toBe("5000");
        expect(response.headers.get("x-ratelimit-remaining")).toBe("4999");
        expect(response.headers.get("x-ratelimit-resource")).toBe("core");
        expect(response.headers.get("x-ratelimit-reset")).toBe(
            String(Math.floor((NOW.getTime() + 3_600_000) / 1_000)),
        );
        expect(response.headers.get("etag")).toMatch(/^"[0-9a-f]{40}"$/);
        expect(github.calls).toEqual([
            { method: "GET", path: CONTENTS, status: 200, pool: "core", window: NOW.getTime() },
        ]);
    });

    it("answers 304 to a matching If-None-Match and serves a changed config afresh", async () => {
        const github = await started();
        const first = await fetch(`${github.origin}${CONTENTS}`);
        const etag = first.headers.get("etag") ?? "";
        const again = await fetch(`${github.origin}${CONTENTS}`, {
            headers: { "if-none-match": etag },
        });
        expect(again.status).toBe(304);
        github.setConfig("version: 2\n");
        const changed = await fetch(`${github.origin}${CONTENTS}`, {
            headers: { "if-none-match": etag },
        });
        const body = (await changed.json()) as { content: string };
        expect(changed.status).toBe(200);
        expect(Buffer.from(body.content, "base64").toString()).toBe("version: 2\n");
        expect(github.calls.map(({ status }) => status)).toEqual([200, 304, 200]);
    });

    it("charges graphql to its own pool and answers an unknown route 404", async () => {
        const github = await started();
        const graphql = await fetch(`${github.origin}/graphql`, { method: "POST", body: "{}" });
        expect(graphql.headers.get("x-ratelimit-resource")).toBe("graphql");
        expect(graphql.headers.get("etag")).toBeNull();
        const missing = await fetch(`${github.origin}/repos/o/r/nothing`);
        expect(missing.status).toBe(404);
        expect(github.calls.map(({ pool }) => pool)).toEqual(["graphql", "core"]);
    });
});

describe("the fake GitHub answers writes", () => {
    it("answers a comment with an id and the body sent", async () => {
        const github = await started();
        const response = await fetch(`${github.origin}/repos/o/r/issues/12/comments`, {
            method: "POST",
            body: JSON.stringify({ body: "hello" }),
        });
        expect(response.status).toBe(201);
        expect(await response.json()).toMatchObject({ id: 1, body: "hello" });
    });
});

describe("the fake GitHub's switches", () => {
    it("refuses every write as an App without the grant, and reads still pass", async () => {
        const github = await started();
        github.refuseWrites(true);
        for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
            const response = await fetch(`${github.origin}/repos/o/r/issues/12/comments`, {
                method,
                body: "{}",
            });
            expect(response.status, method).toBe(403);
            expect(await response.json()).toMatchObject({
                message: "Resource not accessible by integration",
            });
        }
        expect((await fetch(`${github.origin}${CONTENTS}`)).status).toBe(200);
        github.refuseWrites(false);
        const lifted = await fetch(`${github.origin}/repos/o/r/issues/12/comments`, {
            method: "POST",
            body: "{}",
        });
        expect(lifted.status).toBe(201);
    });

    it("answers every request 403 with retry-after past a secondary limit", async () => {
        const github = await started();
        github.secondaryLimit(true);
        for (const method of ["GET", "POST"]) {
            const response = await fetch(`${github.origin}/repos/o/r/issues`, { method });
            expect(response.status, method).toBe(403);
            expect(response.headers.get("retry-after")).toBe("60");
            expect(await response.text()).toContain("secondary rate limit");
        }
        github.secondaryLimit(false);
        expect((await fetch(`${github.origin}/repos/o/r/issues`)).status).toBe(200);
    });

    it("answers the config route 404 while the file is absent", async () => {
        const github = await started();
        github.noConfig(true);
        expect((await fetch(`${github.origin}${CONTENTS}`)).status).toBe(404);
        expect((await fetch(`${github.origin}/repos/o/r/issues`)).status).toBe(200);
        github.noConfig(false);
        expect((await fetch(`${github.origin}${CONTENTS}`)).status).toBe(200);
    });
});

describe("the fake GitHub closes", () => {
    it("refuses connections once closed", async () => {
        const github = await started();
        await fetch(`${github.origin}${CONTENTS}`);
        await github.close();
        fake = undefined;
        await expect(fetch(`${github.origin}${CONTENTS}`)).rejects.toThrow();
    });
});
