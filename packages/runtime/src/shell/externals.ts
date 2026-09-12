/**
 * The facts core cannot know, and how the processor obtains them for one
 * delivery. The live fill lives in the adapter and is composed only at
 * `main.ts`; the stub below is the credential-free path — CI permanently,
 * and any run without App credentials.
 */

import {
    createDestructiveWarning,
    isAutomationLogin,
    type ActionClass,
    type DestructiveWarning,
    type Externals,
    type RepositoryConfig,
    type ResolverAnswer,
    type ResolverSource,
} from "@hiero-hackers/automation-core";
import type { Store } from "../store/index.js";

export type ShellExternals = Omit<Externals, "now">;

/**
 * The recorded-warning seam, over the owned store (grace.md §2).
 *
 * The row is bytes; `createDestructiveWarning` is the only constructor, so
 * re-minting is what turns them back into authority. Nothing here judges the
 * result — the destructive door matches the snapshot against the request it is
 * asked about, which is precisely the check a row read back cannot be trusted
 * to have kept true.
 *
 * A row whose instants no longer parse re-mints to a warning carrying `NaN`,
 * which the door refuses as `invalidDestructivePlan` rather than acting on; a
 * row whose `action_class` is not a class any more fails the snapshot match
 * and is refused as `warningRequestMismatch`. That is the reason this does no
 * validating of its own: one place decides what a warning must look like, and
 * it is not the reader. `requiredPermissions` is empty because the snapshot
 * does not carry it — the act's own request supplies the grants the general
 * rules check.
 */
export function recordedWarningsIn(store: Store): (effectId: string) => DestructiveWarning | null {
    return (effectId) => {
        const row = store.warning(effectId);
        if (row === null) return null;
        return createDestructiveWarning({
            request: {
                capability: row.capability,
                actionClass: row.actionClass as ActionClass,
                requiredPermissions: [],
                cause: row.cause,
                causeObservedAt: new Date(row.causeObservedAt),
                target: { item: row.item, change: row.change },
            },
            warnedAt: new Date(row.warnedAt),
            gracePeriodDays: row.gracePeriodDays,
            earliestActionAt: new Date(row.earliestActionAt),
            cancelledBy: row.cancelledBy,
            reversesWith: row.reversesWith,
        });
    };
}

/**
 * One delivery's externals, built from its raw payload.
 *
 * The live path resolves grants and binds the delivery's ordering-evidence
 * memo here; the stub path ignores both fields. A rejection releases the
 * processor's claim, so the delivery retries later rather than deciding on
 * facts that could not be established.
 *
 * `deliveryId` is passed for correlation only — nothing decides on it. It
 * is here because the live fill's diagnostics leave through seams of its
 * own, and a line about evidence that could not be read is worth nothing
 * unless it names the delivery that could not read it.
 */
export type ExternalsForDelivery = (delivery: {
    readonly payload: unknown;
    readonly deliveryId: string;
    /**
     * The configuration this delivery was decided under. The live fill hands
     * it to the resolver source, which needs the label mapping to answer a
     * question in meanings rather than in the repository's own words — so it
     * arrives per delivery, as the revision it was read at.
     */
    readonly config: RepositoryConfig;
}) => ShellExternals | Promise<ShellExternals>;

/**
 * The resolvers that need no credential, answered on the credential-free path.
 *
 * `isAutomationActor` is a string test on core's observed `[bot]` suffix, so
 * withholding it here would silence every capability that declares it — and
 * silence it CORRECTLY, since the catalogue's "unknown is not an answer"
 * (`design/contracts/catalogue.md`) forbids reading a lookup that could not
 * answer as a negative one (D51). A resolver the platform can answer
 * without talking to anybody is one it must answer. That withholding is D3:
 * intake was permanently silent in CI, and only four shell end-to-end tests
 * noticed.
 *
 * Everything else genuinely needs the App's credentials, so it stays
 * `unavailable`: this source is the credential-free half of the live one,
 * never a stand-in for it.
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

export function stubbedExternals(overrides: Partial<ShellExternals> = {}): ShellExternals {
    return {
        killSwitchActive: false,
        installationGrants: ["issues:write"],
        resolve: credentialFreeResolvers(),
        /**
         * `null` (no ordering evidence), NOT `"unknown"`: `"unknown"` is a
         * safe conflict (`design/contracts/safety.md` §3) and would refuse every write,
         * burying dry-run's interesting findings under a uniform refusal.
         * On this CREDENTIAL-FREE path dry-run reports OVERSTATE what
         * would apply (D93); the live path answers from the issue
         * timeline instead (D119).
         */
        latestHumanChangeAt: () => null,
        ...overrides,
    };
}
