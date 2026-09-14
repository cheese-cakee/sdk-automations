/**
 * The live fill: credentials in, the seams the shell would otherwise stub out.
 * The one place the composition holds an App's private key, and the only
 * directory of the runtime allowed to reach the adapter at all.
 */

import { readFileSync } from "node:fs";
import type { AdmittedCapability, Externals, RepositoryRef } from "@hiero-hackers/automation-core";
import {
    createFactsReader,
    createGitHubHttpClient,
    createReadBack,
    createTokenSource,
    createWriteVerbs,
    githubConfigSource,
    githubMintInstallationToken,
    installationGrants,
    liveExternalsForDelivery,
    orderingEvidenceSource,
    wait,
    withRequestBudget,
    type FactsReader,
    type OrderingEvidenceOptions,
    type ReadBack,
    type WriteVerbs,
} from "../../adapter/index.js";
import type { EffectReader, EffectWriter } from "../apply/apply.js";
import type { Log } from "../log.js";
import type { RequestBudget, SweepFacts } from "../sweep/sweep.js";
import type { Credentials } from "./composition.js";
import type { RepositorySeams } from "./shell.js";

/**
 * The applier's seams, held against the adapter objects that fill them.
 * The ONLY file allowed to see both, so the only place a drift can be caught. A CONSTRAINT rather than a conditional, which would evaluate to `never` and compile.
 */
type Satisfies<Contract, Given extends Contract> = Given;
type _WriterSeamIsTheAdapterSurface = Satisfies<EffectWriter, WriteVerbs>;
type _ReaderSeamIsTheAdapterSurface = Satisfies<EffectReader, ReadBack>;
type _SweepSeamIsTheAdapterSurface = Satisfies<SweepFacts, FactsReader>;

export interface LiveGitHub {
    /** One set per repository, built on demand and held: the installation may deliver for any. */
    readonly seamsFor: (repository: RepositoryRef, budget?: RequestBudget) => RepositorySeams;
}

/** The record's own fields, plus the seams a record cannot carry. */
export interface LiveOptions {
    readonly credentials: Credentials;
    readonly writes: { readonly appSlug: string } | null;
    readonly killSwitchActive: boolean;
    readonly clock: () => Date;
    /** Handed down because the adapter may not import the capabilities package. */
    readonly knownCapabilities: readonly AdmittedCapability[];
    /** One repository's landed calls, as the adapter's ordering read asks for them (D159). */
    readonly ownWrites: (repository: RepositoryRef) => OrderingEvidenceOptions["ownWrites"];
    readonly log: Log;
}

export function liveGitHub({
    credentials: { appId, installationId, privateKeyPath },
    writes,
    killSwitchActive,
    clock,
    knownCapabilities,
    ownWrites,
    log,
}: LiveOptions): LiveGitHub {
    let privateKeyPem: string;
    try {
        // Stryker disable next-line StringLiteral: an emptied encoding yields the same PEM as a Buffer, which node's signer accepts identically — the mutant is equivalent.
        privateKeyPem = readFileSync(privateKeyPath, "utf8");
    } catch {
        console.error(`PRIVATE_KEY_PATH could not be read: ${privateKeyPath}`);
        process.exit(1);
    }
    const tokenSource = createTokenSource({
        credentials: { appId, installationId, privateKeyPem },
        mint: githubMintInstallationToken(),
        clock,
    });
    const http = createGitHubHttpClient({ tokenSource });

    /** One repository's seams, each built exactly as a one-repository process built them. */
    const seamsIn = (repository: RepositoryRef, requestBudget?: RequestBudget): RepositorySeams => {
        const client = requestBudget === undefined ? http : withRequestBudget(http, requestBudget);
        const landed = ownWrites(repository);

        /**
         * The applier's externals, built FRESH on every call (`EffectExternalsSource`).
         * No cause fingerprint is excluded — a known over-refusal, since the seam carries no cause: refusing a write it could have made beats writing over a human's edit.
         */
        const effectExternals = async (): Promise<Externals> => {
            const grants = await installationGrants(tokenSource);
            if (!grants.ok) {
                throw new Error(
                    `the installation's grants could not be read: ${grants.failure.kind}`,
                );
            }
            return {
                killSwitchActive,
                installationGrants: grants.grants,
                latestHumanChangeAt: orderingEvidenceSource({
                    http: client,
                    repository,
                    ownWrites: landed,
                }),
            };
        };

        return {
            facts: (config, budget) =>
                createFactsReader({
                    http: requestBudget === undefined ? withRequestBudget(http, budget) : client,
                    repository,
                    config,
                    clock,
                    knownCapabilities,
                }),
            configSource: githubConfigSource({ client, repository }),
            // One call per delivery, so the seam below is bound to that delivery.

            externals: async ({ payload, deliveryId, config }) => {
                const outcome = await liveExternalsForDelivery(
                    {
                        tokenSource,
                        http: client,
                        repository,
                        config,
                        knownCapabilities,
                        ownWrites: landed,
                        onUnknownOrdering: (detail) => {
                            log({ event: "orderingUnknown", deliveryId, detail });
                        },
                    },
                    payload,
                );
                // Stryker disable next-line all: see above — no arrangement of the composition lets a test reach this branch; the config read fails on the same token first.
                // The config read always runs first on the same token source, so every way of
                // breaking the token surfaces there; this guards a token dying between reads.

                if (!outcome.ok) {
                    // Stryker disable next-line all: as above.
                    throw new Error(`live externals unavailable: ${outcome.failure.kind}`);
                }
                return { killSwitchActive, ...outcome.facts };
            },
            writePath:
                writes === null
                    ? null
                    : {
                          writer: createWriteVerbs({ http: client, repository }),
                          reader: createReadBack({
                              http: client,
                              repository,
                              // Both halves of the one App registration this process already holds.

                              identity: { appId, botLogin: `${writes.appSlug}[bot]` },
                              clock,
                              // The read-back's absence rule is a real second apart, so production waits it.

                              sleep: wait,
                          }),
                          externals: effectExternals,
                      },
        };
    };

    const built = new Map<string, RepositorySeams>();
    return {
        seamsFor: (repository, budget) => {
            if (budget !== undefined) return seamsIn(repository, budget);
            const key = `${repository.owner}/${repository.repo}`;
            const held = built.get(key) ?? seamsIn(repository);
            built.set(key, held);
            return held;
        },
    };
}
