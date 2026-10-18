/**
 * GitHub as an HTTP process on an ephemeral loopback port, answering from the same route table
 * as the in-process script. Switches change the answers while it runs; `calls` is what was charged.
 */

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { githubScript, type GitHubCall } from "./github-routes.js";

export interface FakeGitHubOptions {
    readonly now: () => Date;
    readonly config: () => string;
}

export interface FakeGitHub {
    readonly origin: string;
    readonly calls: readonly GitHubCall[];
    setConfig(text: string): void;
    refuseWrites(on: boolean): void;
    /** `retryAfterSeconds` shortens the wait the refusal asks for; GitHub asks a minute. */
    secondaryLimit(on: boolean, retryAfterSeconds?: number): void;
    noConfig(on: boolean): void;
    close(): Promise<void>;
}

export async function startFakeGitHub(options: FakeGitHubOptions): Promise<FakeGitHub> {
    let config: string | undefined;
    let refusing = false;
    let limited = false;
    let retryAfter = 60;
    let absent = false;
    const script = githubScript({
        now: options.now,
        config: () => config ?? options.config(),
        secondaryLimited: () => limited,
        retryAfterSeconds: () => retryAfter,
        refusesWrites: () => refusing,
        noConfig: () => absent,
    });
    const server = createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
            const reply = script.answer({
                method: request.method ?? "GET",
                path: new URL(request.url ?? "/", "http://fake.invalid").pathname,
                ifNoneMatch: request.headers["if-none-match"] ?? null,
                body: Buffer.concat(chunks).toString("utf8"),
            });
            response.writeHead(reply.status, {
                "content-type": "application/json; charset=utf-8",
                ...reply.headers,
            });
            response.end(reply.body ?? undefined);
        });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    return {
        origin: `http://127.0.0.1:${String(port)}`,
        calls: script.calls,
        setConfig: (text) => {
            config = text;
        },
        refuseWrites: (on) => {
            refusing = on;
        },
        secondaryLimit: (on, retryAfterSeconds = 60) => {
            limited = on;
            retryAfter = retryAfterSeconds;
        },
        noConfig: (on) => {
            absent = on;
        },
        close: () =>
            new Promise<void>((resolve, reject) => {
                server.close((error) => (error === undefined ? resolve() : reject(error)));
                server.closeAllConnections();
            }),
    };
}
