/**
 * The edge's contract: verify before anything, accept before the 202, and
 * a truthful status for every way a delivery can be wrong. Boundary and
 * ordering cases run over real HTTP; stream failures use explicit request
 * doubles so otherwise-unreachable transport events remain deterministic.
 */

import { describe, expect, it } from "vitest";
import { createServer, request as httpRequest, type ServerResponse } from "node:http";
import { connect as netConnect, type AddressInfo } from "node:net";
import { PassThrough } from "node:stream";
import type { IncomingMessage } from "node:http";
import { signBody, SIGNATURE_HEADER } from "@hiero-hackers/automation-core";
import {
    createReceiver,
    type AcceptedDelivery,
    type AcceptOutcome,
    type RequestHandler,
} from "../src/receiver.js";

const SECRET = "shell-test-secret";
const GUID = "72d3162e-cc78-11e3-81ab-4c9367dc0958";
const BODY = JSON.stringify({ action: "opened" });

interface PostOverrides {
    readonly body?: string | Uint8Array;
    readonly signature?: string | null;
    readonly guid?: string | null;
    readonly event?: string | null;
    readonly method?: string;
}

/** One request against a real listening socket; the server lives per call. */
async function post(handler: RequestHandler, overrides: PostOverrides = {}): Promise<number> {
    const server = createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
        const { port } = server.address() as AddressInfo;
        const body = Buffer.from(overrides.body ?? BODY);
        const headers: Record<string, string> = {};
        const signature =
            overrides.signature === undefined ? signBody(SECRET, body) : overrides.signature;
        if (signature !== null) headers[SIGNATURE_HEADER] = signature;
        const guid = overrides.guid === undefined ? GUID : overrides.guid;
        if (guid !== null) headers["x-github-delivery"] = guid;
        const event = overrides.event === undefined ? "issues" : overrides.event;
        if (event !== null) headers["x-github-event"] = event;
        const method = overrides.method ?? "POST";
        if (method !== "GET") headers["content-length"] = String(body.length);
        return await new Promise<number>((resolve, reject) => {
            let settled = false;
            const request = httpRequest(
                {
                    host: "127.0.0.1",
                    port,
                    path: "/",
                    method,
                    headers,
                },
                (response) => {
                    response.resume();
                    response.on("end", () => {
                        settled = true;
                        resolve(response.statusCode ?? 0);
                    });
                },
            );
            request.on("error", (error) => {
                if (!settled) reject(error);
            });
            request.end(method === "GET" ? undefined : body);
        });
    } finally {
        await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
        );
    }
}

function requestStream(): IncomingMessage & PassThrough {
    const request = new PassThrough() as IncomingMessage & PassThrough;
    request.method = "POST";
    request.headers = {};
    return request;
}

function responseRecorder(alreadySent = false): {
    readonly response: ServerResponse;
    readonly status: () => number | undefined;
    readonly ended: () => boolean;
} {
    let status: number | undefined;
    let ended = false;
    let headersSent = alreadySent;
    const response = {
        get headersSent() {
            return headersSent;
        },
        writeHead(code: number) {
            status = code;
            headersSent = true;
            return response;
        },
        end() {
            ended = true;
            return response;
        },
    } as unknown as ServerResponse;
    return { response, status: () => status, ended: () => ended };
}

function recordingAccept(outcome: AcceptOutcome = "accepted") {
    const calls: AcceptedDelivery[] = [];
    return {
        calls,
        accept: (delivery: AcceptedDelivery): AcceptOutcome => {
            calls.push(delivery);
            return outcome;
        },
    };
}

async function interruptRealRequest(mode: "client-abort" | "server-error"): Promise<number> {
    let acceptCalls = 0;
    let requestSeen!: () => void;
    const sawRequest = new Promise<void>((resolve) => {
        requestSeen = resolve;
    });
    let handlerDone!: () => void;
    const handlerCompletion = new Promise<void>((resolve) => {
        handlerDone = resolve;
    });
    const receiver = createReceiver({
        secret: SECRET,
        accept: () => {
            acceptCalls += 1;
            return "accepted";
        },
    });
    const server = createServer((request, response) => {
        requestSeen();
        void receiver(request, response).then(handlerDone);
        if (mode === "server-error") {
            request.destroy(new Error("injected socket failure"));
        }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const socket = netConnect(port, "127.0.0.1");
    socket.on("error", () => undefined);
    try {
        await new Promise<void>((resolve) => socket.once("connect", resolve));
        socket.write(
            "POST / HTTP/1.1\r\n" +
                `Host: 127.0.0.1:${port}\r\n` +
                "Content-Length: 100\r\n" +
                "Connection: close\r\n\r\n" +
                "partial",
        );
        await sawRequest;
        if (mode === "client-abort") socket.destroy();
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("receiver did not settle")), 1_000);
            void handlerCompletion.then(() => {
                clearTimeout(timer);
                resolve();
            }, reject);
        });
        return acceptCalls;
    } finally {
        socket.destroy();
        await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
        );
    }
}

describe("verification comes first", () => {
    it("an unsigned delivery is 401 and never reaches accept", async () => {
        const { calls, accept } = recordingAccept();
        const status = await post(createReceiver({ secret: SECRET, accept }), {
            signature: null,
        });
        expect(status).toBe(401);
        expect(calls).toEqual([]);
    });

    it("a wrongly signed delivery is 401 and never reaches accept", async () => {
        const { calls, accept } = recordingAccept();
        const status = await post(createReceiver({ secret: SECRET, accept }), {
            signature: signBody("some-other-secret", BODY),
        });
        expect(status).toBe(401);
        expect(calls).toEqual([]);
    });
});

describe("acceptance comes before the acknowledgement", () => {
    it("a verified delivery is accepted with its exact bytes, then 202", async () => {
        const { calls, accept } = recordingAccept();
        const raw = Buffer.concat([
            Buffer.from('{\n  "action": "opened", "bytes": "', "utf8"),
            Buffer.from([0x00, 0xff, 0x80]),
            Buffer.from('"\n}', "utf8"),
        ]);
        const status = await post(createReceiver({ secret: SECRET, accept }), {
            body: raw,
        });
        expect(status).toBe(202);
        expect(calls).toHaveLength(1);
        expect(Buffer.from(calls[0]!.payload)).toEqual(raw);
        expect(calls[0]!.deliveryId).toBe(GUID);
        expect(calls[0]!.eventName).toBe("issues");
    });

    it("a failed accept is 500, not 202 — unstored means unacknowledged", async () => {
        const receiver = createReceiver({
            secret: SECRET,
            accept: () => {
                throw new Error("store unavailable");
            },
        });
        expect(await post(receiver)).toBe(500);
    });

    it("a duplicate is 202 — the redelivery already has its durable row", async () => {
        const { accept } = recordingAccept("duplicate");
        expect(await post(createReceiver({ secret: SECRET, accept }))).toBe(202);
    });

    it("a conflict is 409 — same GUID, different bytes, never acknowledged", async () => {
        const { accept } = recordingAccept("conflict");
        expect(await post(createReceiver({ secret: SECRET, accept }))).toBe(409);
    });

    it("the pump fires only after an acknowledged delivery", async () => {
        let pumped = 0;
        const { accept } = recordingAccept();
        const receiver = createReceiver({
            secret: SECRET,
            accept,
            onAccepted: () => {
                pumped += 1;
            },
        });
        await post(receiver);
        expect(pumped).toBe(1);
        await post(receiver, { signature: null });
        expect(pumped).toBe(1);
    });

    it("starts the processing pump only after the real response finish boundary", async () => {
        let finishObserved = false;
        let pumpCalls = 0;
        const receiver = createReceiver({
            secret: SECRET,
            accept: () => "accepted",
            onAccepted: () => {
                expect(finishObserved).toBe(true);
                pumpCalls += 1;
            },
        });
        const server = createServer((request, response) => {
            response.once("finish", () => {
                finishObserved = true;
            });
            void receiver(request, response);
        });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        try {
            const { port } = server.address() as AddressInfo;
            const body = Buffer.from(BODY);
            const status = await new Promise<number>((resolve, reject) => {
                const request = httpRequest(
                    {
                        host: "127.0.0.1",
                        port,
                        path: "/",
                        method: "POST",
                        headers: {
                            [SIGNATURE_HEADER]: signBody(SECRET, body),
                            "x-github-delivery": GUID,
                            "x-github-event": "issues",
                            "content-length": String(body.length),
                        },
                    },
                    (response) => {
                        response.resume();
                        response.on("end", () => resolve(response.statusCode ?? 0));
                    },
                );
                request.on("error", reject);
                request.end(body);
            });
            expect(status).toBe(202);
            expect(finishObserved).toBe(true);
            expect(pumpCalls).toBe(1);
        } finally {
            await new Promise<void>((resolve, reject) =>
                server.close((error) => (error ? reject(error) : resolve())),
            );
        }
    });
});

describe("body limits and interrupted streams fail closed", () => {
    it("accepts exactly 25 MiB and rejects the next byte", async () => {
        const { calls, accept } = recordingAccept();
        const receiver = createReceiver({ secret: SECRET, accept });
        const atLimit = Buffer.alloc(25 * 1024 * 1024, 0x61);
        expect(await post(receiver, { body: atLimit })).toBe(202);
        expect(calls[0]?.payload.byteLength).toBe(atLimit.length);

        const overLimit = Buffer.alloc(atLimit.length + 1, 0x62);
        expect(await post(receiver, { body: overLimit })).toBe(413);
        expect(calls).toHaveLength(1);
    }, 30_000);

    it.each(["client-abort", "server-error"] as const)(
        "settles a real %s request without accepting partial input",
        async (mode) => {
            expect(await interruptRealRequest(mode)).toBe(0);
        },
    );

    it.each(["aborted", "error"] as const)(
        "handles the isolated %s fallback without accepting partial input",
        async (event) => {
            const { calls, accept } = recordingAccept();
            const request = requestStream();
            const recorded = responseRecorder();
            const completion = createReceiver({ secret: SECRET, accept })(
                request,
                recorded.response,
            );
            if (event === "aborted") request.emit(event);
            else request.emit(event, new Error("socket failed"));
            await completion;
            expect(recorded.status()).toBe(500);
            expect(calls).toEqual([]);
        },
    );

    it("does not try to replace a response whose headers were already sent", async () => {
        const request = requestStream();
        const recorded = responseRecorder(true);
        const completion = createReceiver({
            secret: SECRET,
            accept: () => "accepted",
        })(request, recorded.response);
        request.emit("error", new Error("late socket error"));
        await completion;
        expect(recorded.status()).toBeUndefined();
        expect(recorded.ended()).toBe(false);
    });
});

describe("malformed requests get truthful statuses", () => {
    /**
     * Each row is one malformed request and the status it earns. Reaching
     * `accept` is asserted against for every row, not just some: a delivery
     * the edge could not even address must never reach the store.
     */
    it.each([
        ["a non-POST", 405, { method: "GET", signature: null }],
        ["a signed delivery without a GUID", 400, { guid: null }],
        ["a signed delivery with a malformed GUID", 400, { guid: "not-a-guid" }],
        ["a signed delivery without an event name", 400, { event: null }],
        ["a signed delivery with an empty event name", 400, { event: "" }],
    ] as const)("%s is %i", async (_name, expectedStatus, overrides) => {
        const { calls, accept } = recordingAccept();
        const status = await post(createReceiver({ secret: SECRET, accept }), overrides);
        expect(status).toBe(expectedStatus);
        expect(calls).toEqual([]);
    });

    it.each([
        [SIGNATURE_HEADER, [signBody(SECRET, BODY)], 401],
        ["x-github-delivery", [GUID], 400],
    ] as const)("rejects a repeated %s header", async (header, value, expectedStatus) => {
        const { calls, accept } = recordingAccept();
        const request = requestStream();
        request.headers = {
            [SIGNATURE_HEADER]: signBody(SECRET, BODY),
            "x-github-delivery": GUID,
            "x-github-event": "issues",
            [header]: [...value],
        };
        const recorded = responseRecorder();
        const completion = createReceiver({ secret: SECRET, accept })(request, recorded.response);
        request.end(BODY);
        await completion;
        expect(recorded.status()).toBe(expectedStatus);
        expect(calls).toEqual([]);
    });
});
