/**
 * What token we may call with, right now.
 * Three ages decide below: too new to doubt, due for refresh, past expiry.
 */

import {
    isPermissionGrant,
    type FailureClass,
    type PermissionGrant,
} from "@hiero-hackers/automation-core";
import { signAppAssertion, type AppCredentials } from "./jwt.js";

// ─── What an ask for a token produces ────────────────────────────────

export interface InstallationToken {
    readonly value: string;
    readonly expiresAt: Date;
    readonly grants: readonly PermissionGrant[];
}

/** A token, or the classified reason there is none. */
export type TokenOutcome =
    | { readonly ok: true; readonly token: InstallationToken }
    | { readonly ok: false; readonly failure: FailureClass };

/** Whether an injected source's outcome is safe to build a live request from. */
export function isWellFormedTokenOutcome(outcome: TokenOutcome): boolean {
    if (typeof outcome !== "object" || outcome === null || typeof outcome.ok !== "boolean") {
        return false;
    }
    if (!outcome.ok) {
        return (
            typeof outcome.failure === "object" &&
            outcome.failure !== null &&
            typeof outcome.failure.kind === "string"
        );
    }
    const token = outcome.token;
    return (
        typeof token === "object" &&
        token !== null &&
        typeof token.value === "string" &&
        token.expiresAt instanceof Date &&
        Number.isFinite(token.expiresAt.getTime()) &&
        Array.isArray(token.grants)
    );
}

/**
 * Injected, and it must not throw; every failure arrives as a `FailureClass`.
 * Credentials are a parameter, never closed over: the endpoint names the installation.
 */
export type MintInstallationToken = (
    assertion: string,
    credentials: AppCredentials,
) => Promise<TokenOutcome>;

// ─── Reading a token's age ───────────────────────────────────────────

export const REFRESH_SKEW_SECONDS = 300;

/** A failed mint may be retried once this pause elapses. */
export const MINT_RETRY_COOLDOWN_SECONDS = 60;

/**
 * `classifyFailure`'s one local input: an expired token and a wrong key return
 * byte-identical 401 bodies.
 */
export function isPastExpiry(token: InstallationToken, now: Date): boolean {
    return now.getTime() >= token.expiresAt.getTime();
}

/** Inside the skew window: replace this token, though it is still usable. */
export function isDueForRefresh(token: InstallationToken, now: Date): boolean {
    return now.getTime() + REFRESH_SKEW_SECONDS * 1000 >= token.expiresAt.getTime();
}

/**
 * A token minted less than this ago is valid by GitHub's clock, whatever ours says.
 * Not a rate limit and not a tunable.
 */
export const MINT_FLOOR_SECONDS = 60;

/**
 * GitHub's `permissions` object as core's grant vocabulary.
 * Levels with no `PermissionGrant` representation are dropped, not guessed at.
 */
export function grantsFromPermissions(
    permissions: Readonly<Record<string, string>>,
): readonly PermissionGrant[] {
    return Object.entries(permissions)
        .map(([scope, level]) => `${scope}:${level}`)
        .filter(isPermissionGrant);
}

// ─── The source ──────────────────────────────────────────────────────

export interface TokenSourceOptions {
    readonly credentials: AppCredentials;
    readonly mint: MintInstallationToken;
    readonly clock: () => Date;
}

/** The cached, self-refreshing token every operation asks for. */
export interface TokenSource {
    current(): Promise<TokenOutcome>;
    /** Drop a token GitHub rejected, so the next call mints a fresh one. */
    invalidate(token: InstallationToken): void;
}

export function createTokenSource({ credentials, mint, clock }: TokenSourceOptions): TokenSource {
    let cached: { readonly token: InstallationToken; readonly mintedAt: Date } | null = null;
    let pending: Promise<TokenOutcome> | null = null;
    let retry: { readonly notBefore: Date; readonly failure: TokenOutcome & { ok: false } } | null =
        null;

    /** One clock for both instants, so skew cannot distort the interval. */
    const withinMintFloor = (mintedAt: Date, now: Date): boolean =>
        now.getTime() - mintedAt.getTime() < MINT_FLOOR_SECONDS * 1000;

    const retryPaused = (now: Date): boolean =>
        retry !== null && now.getTime() < retry.notBefore.getTime();

    /**
     * The three ages in decision order: too new to doubt serves unconditionally,
     * otherwise the token must be usable and no refresh due or the pause still running.
     */
    const mayServeHeldToken = (held: InstallationToken, mintedAt: Date, now: Date): boolean =>
        withinMintFloor(mintedAt, now) ||
        (!isPastExpiry(held, now) && (!isDueForRefresh(held, now) || retryPaused(now)));

    /** Signing is local but still fallible, and an injected mint can break its no-throw promise. */
    const mintSafely = async (): Promise<TokenOutcome> => {
        let assertion: string;
        try {
            assertion = signAppAssertion(credentials, clock());
        } catch {
            return { ok: false, failure: { kind: "badCredentials" } };
        }
        try {
            return await mint(assertion, credentials);
        } catch {
            return { ok: false, failure: { kind: "transient" } };
        }
    };

    /**
     * A failed EARLY refresh must not close the window the skew holds open.
     * `cached` is read here rather than captured, so an `invalidate()` mid-flight is honoured.
     */
    const heldTokenOrFailure = (outcome: TokenOutcome): TokenOutcome => {
        const now = clock();
        if (outcome.ok) return outcome;

        if (cached === null || isPastExpiry(cached.token, now)) {
            retry = {
                notBefore: new Date(now.getTime() + MINT_RETRY_COOLDOWN_SECONDS * 1000),
                failure: outcome,
            };
            return outcome;
        }

        // A secondary limit carries no safe retry signal; other failures get a
        // bounded pause, capped at expiry so an unusable token cannot suppress a mint.

        retry = {
            notBefore:
                outcome.failure.kind === "secondaryLimit"
                    ? cached.token.expiresAt
                    : new Date(
                          Math.min(
                              cached.token.expiresAt.getTime(),
                              now.getTime() + MINT_RETRY_COOLDOWN_SECONDS * 1000,
                          ),
                      ),
            failure: outcome,
        };
        return { ok: true, token: cached.token };
    };

    return {
        current(): Promise<TokenOutcome> {
            const now = clock();
            if (cached !== null && mayServeHeldToken(cached.token, cached.mintedAt, now)) {
                return Promise.resolve({ ok: true, token: cached.token });
            }
            // Stryker disable next-line ConditionalExpression: retryPaused already checks the null; the outer arm exists to narrow the type.
            if (retry !== null && retryPaused(now)) {
                return Promise.resolve(retry.failure);
            }
            // Concurrent callers share one mint; the promise itself never sticks.

            pending ??= mintSafely()
                .then((outcome) => {
                    if (outcome.ok) {
                        cached = { token: outcome.token, mintedAt: clock() };
                        retry = null;
                    }
                    return heldTokenOrFailure(outcome);
                })
                .finally(() => {
                    pending = null;
                });
            return pending;
        },
        invalidate(token: InstallationToken): void {
            // Clearing the cache is what bypasses the floor.

            if (cached?.token.value === token.value) {
                cached = null;
                retry = null;
            }
        },
    };
}
