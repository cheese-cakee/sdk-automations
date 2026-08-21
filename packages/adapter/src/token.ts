/**
 * What token we may call with, right now.
 *
 * An installation token lasts an hour, so this file owns the cache, the early
 * refresh, the single flight that keeps concurrent callers off the mint
 * endpoint, and what happens when that refresh fails while the held token is
 * still good. Minting itself is injected: that request authenticates with the
 * assertion from `jwt.ts` rather than with a token, so it cannot travel
 * through the client that depends on this.
 *
 * Three ages decide everything below, and they are not the same age: one
 * opens the window to replace a token, one closes the window to use it, one
 * says a token is too new to doubt.
 */

import {
    isPermissionGrant,
    type FailureClass,
    type PermissionGrant,
} from "@hiero-hackers/automation-core";
import { signAppAssertion, type AppCredentials } from "./jwt.js";

// ─── What an ask for a token produces ────────────────────────────────

/** A minted token, its own expiry, and the grants the mint response named. */
export interface InstallationToken {
    readonly value: string;
    readonly expiresAt: Date;
    readonly grants: readonly PermissionGrant[];
}

/**
 * A token, or the classified reason there is none.
 *
 * Named for the question rather than for minting: `current()` answers with
 * this too, and its answer is often a cached token no mint just produced.
 */
export type TokenOutcome =
    | { readonly ok: true; readonly token: InstallationToken }
    | { readonly ok: false; readonly failure: FailureClass };

/**
 * The mint call itself, injected.
 *
 * Credentials are a parameter, not something an implementation closes over:
 * the endpoint is `/app/installations/{id}/…`, and a private copy of that id
 * could mint for a different installation than the source authenticates as.
 *
 * It must not throw. Every failure arrives as a `FailureClass`, which is what
 * the HTTP client guarantees on its side of this type.
 */
export type MintInstallationToken = (
    assertion: string,
    credentials: AppCredentials,
) => Promise<TokenOutcome>;

// ─── Reading a token's age ───────────────────────────────────────────

/**
 * Refresh this far ahead of expiry. Long enough that a request starting at
 * the boundary still finishes on a live token, short enough that the extra
 * mint costs one call an hour.
 */
export const REFRESH_SKEW_SECONDS = 300;

/** A failed mint may be tried again after this pause. */
export const MINT_RETRY_COOLDOWN_SECONDS = 60;

/**
 * Was this token already past its own expiry when it was used?
 *
 * `classifyFailure`'s one local input. An expired token and a wrong key
 * return byte-identical 401 bodies, so nothing in the response can tell them
 * apart.
 */
export function isPastExpiry(token: InstallationToken, now: Date): boolean {
    return now.getTime() >= token.expiresAt.getTime();
}

/** Inside the skew window: replace this token, though it is still usable. */
export function isDueForRefresh(token: InstallationToken, now: Date): boolean {
    return now.getTime() + REFRESH_SKEW_SECONDS * 1000 >= token.expiresAt.getTime();
}

/**
 * A token minted less than this ago is valid by GitHub's clock, whatever ours
 * says: the TTL is an hour, so real expiry this soon is impossible and a
 * fresh mint could return nothing better.
 *
 * **Not a rate limit and not a tunable.** Delete it and a fast clock mints on
 * every call, until `secondaryLimit` — the class carrying no wait signal —
 * blocks the App with nothing to say when to stop.
 */
export const MINT_FLOOR_SECONDS = 60;

/**
 * GitHub's `permissions` object as core's grant vocabulary.
 *
 * Levels with no `PermissionGrant` representation — `admin`, on the scopes
 * that have it — are dropped rather than guessed at. Nothing inside the
 * ratified ceiling grants one.
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

    /**
     * Signing is local but still fallible, and an injected implementation can
     * break its no-throw promise. Neither failure may escape this seam.
     */
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
     * A failed EARLY refresh must not close the window the skew holds open:
     * the token we have is still usable, so serve it and retry after a pause.
     *
     * `cached` is read here rather than captured before the mint, so an
     * `invalidate()` landing mid-flight is honoured.
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

        // A secondary limit carries no safe retry signal, so do not try again
        // while the held token works. Other failures get a bounded pause,
        // capped at expiry so an unusable token can never suppress a mint.
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
            if (
                cached !== null &&
                (withinMintFloor(cached.mintedAt, now) ||
                    (!isPastExpiry(cached.token, now) &&
                        (!isDueForRefresh(cached.token, now) ||
                            (retry !== null && now.getTime() < retry.notBefore.getTime()))))
            ) {
                return Promise.resolve({ ok: true, token: cached.token });
            }
            if (retry !== null && now.getTime() < retry.notBefore.getTime()) {
                return Promise.resolve(retry.failure);
            }
            // Concurrent callers share one mint. A proactive failure may
            // leave a retry pause above, but the promise itself never sticks.
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
