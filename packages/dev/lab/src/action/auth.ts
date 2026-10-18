/**
 * Who the runner acts as: a person's token, or an App installation token minted from the
 * App's key the way `lab:probe` mints it. A token wins where both are set.
 */

import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { field, Halt } from "../github.js";

const API_ORIGIN = "https://api.github.com";

const API_VERSION = "2026-03-10";

const USER_AGENT = "hiero-hackers-sdk-automations-rehearsal";

/** GitHub rejects an assertion whose `iat` sits in its own future. */
const BACKDATE_SECONDS = 60;

const ASSERTION_SECONDS = 540;

export type Credentials =
    | { readonly kind: "token"; readonly token: string }
    | {
          readonly kind: "app";
          readonly appId: string;
          readonly installationId: string;
          readonly keyPath: string;
      };

const held = (env: NodeJS.ProcessEnv, name: string): string | undefined => {
    const value = env[name]?.trim();
    return value === "" ? undefined : value;
};

/** The credentials the environment holds, or the names that would complete one. */
export function credentialsOf(env: NodeJS.ProcessEnv): Credentials | string[] {
    const token = held(env, "GITHUB_TOKEN");
    if (token !== undefined) return { kind: "token", token };
    const [appId, installationId, keyPath] = ["APP_ID", "INSTALLATION_ID", "PRIVATE_KEY_PATH"].map(
        (name) => held(env, name),
    );
    if (appId !== undefined && installationId !== undefined && keyPath !== undefined) {
        return { kind: "app", appId, installationId, keyPath };
    }
    return ["GITHUB_TOKEN, or APP_ID with INSTALLATION_ID and PRIVATE_KEY_PATH"];
}

const encode = (claims: object): string =>
    Buffer.from(JSON.stringify(claims)).toString("base64url");

function assertion(appId: string, keyPath: string): string {
    const issuedAt = Math.floor(Date.now() / 1000) - BACKDATE_SECONDS;
    const input = [
        encode({ alg: "RS256", typ: "JWT" }),
        encode({ iat: issuedAt, exp: issuedAt + ASSERTION_SECONDS, iss: appId }),
    ].join(".");
    try {
        const signature = createSign("RSA-SHA256")
            .update(input)
            .sign(readFileSync(keyPath, "utf8"));
        return `${input}.${signature.toString("base64url")}`;
    } catch {
        throw new Halt("PRIVATE_KEY_PATH did not sign an assertion");
    }
}

/** The token to call with: the person's own, or a fresh installation token. */
export async function tokenOf(credentials: Credentials): Promise<string> {
    if (credentials.kind === "token") return credentials.token;
    const url = `${API_ORIGIN}/app/installations/${credentials.installationId}/access_tokens`;
    const response = await fetch(url, {
        method: "POST",
        headers: {
            accept: "application/vnd.github+json",
            authorization: `Bearer ${assertion(credentials.appId, credentials.keyPath)}`,
            "user-agent": USER_AGENT,
            "x-github-api-version": API_VERSION,
        },
        redirect: "manual",
    }).catch(() => null);
    const minted = field(await response?.json().catch(() => null), "token");
    if (typeof minted !== "string" || minted.length === 0) {
        throw new Halt(`the mint answered ${String(response?.status ?? "nothing")} with no token`);
    }
    return minted;
}
