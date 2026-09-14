/** The facts core cannot know, obtained for one item; the live fill is composed only at `main.ts`. */

import {
    isAutomationLogin,
    type Externals,
    type RepositoryConfig,
    type ResolverAnswer,
    type ResolverSource,
} from "@hiero-hackers/automation-core";

/**
 * One delivery's externals, built from its raw payload.
 * A rejection releases the delivery lane's claim, so the delivery retries later.
 */
export type ExternalsForDelivery = (delivery: {
    readonly payload: unknown;
    readonly deliveryId: string;
    /** The configuration this delivery was decided under, at the revision it was read at. */
    readonly config: RepositoryConfig;
}) => Externals | Promise<Externals>;

/**
 * The resolvers that need no credential, answered on the credential-free path.
 * One the platform can answer without talking to anybody is one it must answer (D51, D3).
 */
export function credentialFreeResolvers(): ResolverSource {
    const resolve = async (query: string, input: unknown): Promise<ResolverAnswer<unknown>> => {
        if (query !== "isAutomationActor") {
            return {
                ok: false,
                reason: "unavailable",
                detail: `"${query}" needs App credentials, which this path has none of`,
            };
        }
        const login = (input as { readonly login?: unknown }).login;
        return typeof login === "string" && login.length > 0
            ? { ok: true, value: isAutomationLogin(login) }
            : { ok: false, reason: "unavailable", detail: "isAutomationActor requires a login" };
    };
    return resolve as ResolverSource;
}

export function stubbedExternals(overrides: Partial<Externals> = {}): Externals {
    return {
        killSwitchActive: false,
        installationGrants: ["issues:write"],
        resolve: credentialFreeResolvers(),
        /** `null`, NOT `"unknown"`: dry-run here OVERSTATES what would apply (D93, D119). */
        latestHumanChangeAt: () => null,
        ...overrides,
    };
}
