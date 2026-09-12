/**
 * The adapter: the only place in the platform that talks to GitHub.
 * Named exports, deliberately — the surface is what a composition root composes.
 * See [README.md](README.md) for what it owns and the seams it fills.
 */

export { signAppAssertion, type AppCredentials } from "./jwt.js";
export { githubMintInstallationToken, type GitHubMintOptions } from "./mint.js";
export { githubConfigSource, type GitHubConfigSourceOptions } from "./config.js";
export { createResolverSource, type ResolverSourceOptions } from "./resolvers.js";
export {
    CONFIRMED_SWEEP_READS,
    createFactsReader,
    GROUP_READS,
    SWEEP_READS,
    type FactsReader,
    type FactsReaderOptions,
    type OpenItem,
    type OpenItemsOutcome,
    type Read,
    type SweepRead,
} from "./facts.js";
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
export { createWriteVerbs, type WriteVerbsOptions } from "./writes.js";
export {
    createReadBack,
    type AppIdentity,
    type CommentFact,
    type ItemFacts,
    type Presence,
    type ReadBack,
    type ReadBackOptions,
    type ReadBackOutcome,
} from "./readback.js";
export {
    type BrokenSeam,
    type FetchLike,
    type GitHubFailure,
    type GitHubHttpClient,
    type GitHubHttpClientOptions,
    type GitHubHttpFailureClass,
    type GitHubOutcome,
    type GitHubRequest,
    type GitHubSuccess,
    type GitHubWriteRequest,
    type NotSentReason,
    type RateLimitSnapshot,
    type WriteIdempotency,
} from "./contract.js";
export { type WriteEndpoint, type WriteResult, type WriteVerbs } from "./operations/transport.js";
export { createGitHubHttpClient, wait } from "./http.js";
