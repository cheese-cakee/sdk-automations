/**
 * The adapter: the only place in the platform that talks to GitHub.
 *
 * See [README.md](README.md) for what it owns, the seams it fills, and why
 * its knowledge goes stale differently from everything else.
 *
 * Named exports, deliberately: the surface is what a composition root
 * composes — the factories, the seam contracts, and the outcome vocabulary.
 * Bounds, windows, and judgement helpers stay inside; a test that needs one
 * imports its module directly.
 */

export { signAppAssertion, type AppCredentials } from "./jwt.js";
export { githubMintInstallationToken, type GitHubMintOptions } from "./mint.js";
export { githubConfigSource, type GitHubConfigSourceOptions } from "./config.js";
export {
    causeFingerprintOf,
    installationGrants,
    liveExternalsForDelivery,
    orderingEvidenceSource,
    type CauseFingerprint,
    type GrantsOutcome,
    type LiveExternalFacts,
    type LiveExternalsOptions,
    type LiveExternalsOutcome,
    type OrderingEvidenceOptions,
} from "./externals.js";
export {
    createTokenSource,
    grantsFromPermissions,
    isWellFormedTokenOutcome,
    type InstallationToken,
    type MintInstallationToken,
    type TokenOutcome,
    type TokenSource,
    type TokenSourceOptions,
} from "./token.js";
export {
    createGitHubHttpClient,
    type BrokenSeam,
    type FetchLike,
    type GitHubFailure,
    type GitHubHttpClient,
    type GitHubHttpClientOptions,
    type GitHubHttpFailureClass,
    type GitHubOutcome,
    type GitHubRequest,
    type GitHubSuccess,
    type NotSentReason,
    type RateLimitSnapshot,
} from "./http.js";
