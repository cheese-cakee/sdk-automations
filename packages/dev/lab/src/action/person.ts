/**
 * What the lab does on an existing item as the person: label, comment, assign, delete, read
 * back. Each change answers GitHub's clock as it began, so a judge can ask what followed it.
 */

import { field, Halt, listOf, type Answer, type Call } from "../github.js";
import type { Sandbox } from "./sandbox.js";

/** GitHub's clock as a change began. */
export interface Moment {
    readonly since: string;
}

export interface Comment {
    readonly id: number;
    readonly login: string | null;
    readonly body: string;
    readonly createdAt: string;
}

export interface Person {
    open(title: string, body?: string): Promise<Moment & { readonly number: number }>;
    /** Replaces every label in one request. */
    setLabels(issue: number, labels: readonly string[]): Promise<Moment>;
    labelsOf(issue: number): Promise<string[]>;
    comment(issue: number, body: string): Promise<Moment>;
    deleteComment(id: number): Promise<Moment>;
    commentsOf(issue: number): Promise<Comment[]>;
    assign(issue: number, login: string): Promise<Moment>;
    assigneesOf(issue: number): Promise<string[]>;
    lockedOf(issue: number): Promise<boolean>;
    stateOf(item: "issues" | "pulls", number: number): Promise<string>;
}

const PAGE = 100;

const stamped = (answer: Answer): Moment => ({ since: answer.date ?? new Date().toISOString() });

export function createPerson(call: Call, sandbox: Sandbox, owner: string, repo: string): Person {
    const repository = `/repos/${owner}/${repo}`;
    const issue = (number: number): string => `${repository}/issues/${String(number)}`;

    const logins = (entries: readonly unknown[]): string[] =>
        entries.flatMap((entry) => {
            const login = field(entry, "login");
            return typeof login === "string" ? [login] : [];
        });

    return {
        async open(title, body = "Temporary fixture for the action protocols.") {
            const answer = await call("POST", `${repository}/issues`, {
                body: { title, body },
                accept: [201],
            });
            const number = field(answer.body, "number");
            if (typeof number !== "number")
                throw new Halt("the issue was created without a number");
            sandbox.adoptIssue(number);
            return { number, ...stamped(answer) };
        },

        async setLabels(number, labels) {
            return stamped(await call("PUT", `${issue(number)}/labels`, { body: { labels } }));
        },

        async labelsOf(number) {
            const answer = await call("GET", `${issue(number)}/labels?per_page=${String(PAGE)}`);
            return listOf(answer, "the labels").flatMap((entry) => {
                const name = field(entry, "name");
                return typeof name === "string" ? [name] : [];
            });
        },

        async comment(number, body) {
            return stamped(
                await call("POST", `${issue(number)}/comments`, { body: { body }, accept: [201] }),
            );
        },

        async deleteComment(id) {
            return stamped(
                await call("DELETE", `${repository}/issues/comments/${String(id)}`, {
                    accept: [204],
                }),
            );
        },

        async commentsOf(number) {
            const answer = await call("GET", `${issue(number)}/comments?per_page=${String(PAGE)}`);
            const entries = listOf(answer, "the comments");
            if (entries.length >= PAGE) throw new Halt(`#${String(number)} has a page of comments`);
            return entries.flatMap((entry) => {
                const id = field(entry, "id");
                const body = field(entry, "body");
                const createdAt = field(entry, "created_at");
                const login = field(field(entry, "user"), "login");
                if (typeof id !== "number" || typeof body !== "string") return [];
                return [
                    {
                        id,
                        body,
                        createdAt: typeof createdAt === "string" ? createdAt : "",
                        login: typeof login === "string" ? login : null,
                    },
                ];
            });
        },

        async assign(number, login) {
            return stamped(
                await call("POST", `${issue(number)}/assignees`, {
                    body: { assignees: [login] },
                    accept: [201],
                }),
            );
        },

        async assigneesOf(number) {
            const held = field((await call("GET", issue(number))).body, "assignees");
            return Array.isArray(held) ? logins(held) : [];
        },

        async lockedOf(number) {
            return field((await call("GET", issue(number))).body, "locked") === true;
        },

        async stateOf(item, number) {
            const state = field(
                (await call("GET", `${repository}/${item}/${String(number)}`)).body,
                "state",
            );
            return typeof state === "string" ? state : "unknown";
        },
    };
}
