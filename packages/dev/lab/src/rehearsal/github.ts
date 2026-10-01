/**
 * The rehearsal's person on GitHub: every call is made with the operator's own token, so each
 * change reaches the shell as a human's. The App's calls are the shell's, never made here.
 */

const API_ORIGIN = "https://api.github.com";

const API_VERSION = "2026-03-10";

const USER_AGENT = "hiero-hackers-sdk-automations-rehearsal";

/** Why the run stopped. Thrown only inside the rehearsal and caught once, before restoring. */
export class Halt extends Error {}

export interface Answer {
    readonly status: number;
    readonly body: unknown;
}

/** One API call, answered with a status the caller accepts or halted with what came back. */
export type Call = (
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    options?: { readonly body?: unknown; readonly accept?: readonly number[] },
) => Promise<Answer>;

export function createGitHub(token: string): Call {
    return async (method, path, { body, accept = [200] } = {}) => {
        let response: Response;
        try {
            response = await fetch(`${API_ORIGIN}${path}`, {
                method,
                headers: {
                    accept: "application/vnd.github+json",
                    authorization: `Bearer ${token}`,
                    "user-agent": USER_AGENT,
                    "x-github-api-version": API_VERSION,
                },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
                redirect: "manual",
            });
        } catch {
            throw new Halt(`${method} ${path} did not complete`);
        }
        const text = await response.text().catch(() => "");
        if (!accept.includes(response.status)) {
            throw new Halt(
                `${method} ${path} answered ${String(response.status)}: ${text.slice(0, 200)}`,
            );
        }
        return { status: response.status, body: parsedOrHalt(text, `${method} ${path}`) };
    };
}

/** A JSON body, or a halt naming the call that answered something else. */
export function parsedOrHalt(text: string, call: string): unknown {
    if (text === "") return null;
    try {
        return JSON.parse(text, exactIntegers) as unknown;
    } catch {
        throw new Halt(`${call} answered a body that is not JSON`);
    }
}

/** Webhook delivery ids exceed 2^53, so an integer a double cannot hold keeps its source text. */
function exactIntegers(_key: string, value: unknown, context?: { source?: string }): unknown {
    return typeof value === "number" && Number.isInteger(value) && !Number.isSafeInteger(value)
        ? context?.source
        : value;
}

/** A field of an untrusted body, or `undefined`; never throws. */
export function field(value: unknown, name: string): unknown {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)[name]
        : undefined;
}

/** An array body, or a halt naming what was read. */
export function listOf(answer: Answer, what: string): readonly unknown[] {
    if (!Array.isArray(answer.body)) throw new Halt(`${what} was not a list`);
    return answer.body;
}

/** What a caught value says, for a person reading the run. */
export function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
