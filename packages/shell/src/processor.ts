/**
 * The worker half: claim a durable delivery, prepare, reject an unsupported
 * mode or call the one verb, then commit the outcome with completion. The
 * receiver acknowledged long ago; GitHub never observes retries here.
 *
 * The reading key: a claimed delivery always ends as exactly ONE of three
 * records — `configRejected`, `modeUnsupported`, or a decision — and there
 * is no fourth exit. The try/catch in `processOnce` is routing, not
 * handling: any throw releases the claim, and retry-by-reclaim IS the
 * recovery logic, which is why none lives here.
 *
 * `recordFor` below is stations ③ to ⑤ of this package's README table,
 * one named step per station.
 */

import {
    decide,
    parseConfigDocument,
    type ConfigResult,
    type ConfigError,
    type Decision,
    type EngineCapability,
    type Report,
    type RepositoryConfig,
    type RepositoryRef,
} from "@hiero-hackers/automation-core";
import type { ClaimedDelivery, Store } from "@hiero-hackers/automation-store";
import type { ConfigSource } from "./config.js";
import type { ExternalsForDelivery } from "./externals.js";

/** A processing claim older than this is presumed dead and taken over. */
const STALE_CLAIM_MINUTES = 15;

/** Dependencies and operator hooks for one durable delivery worker. */
export interface ProcessorOptions {
    readonly store: Store;
    readonly capabilities: readonly EngineCapability[];
    readonly configSource: ConfigSource;
    readonly externals: ExternalsForDelivery;
    /**
     * The shell's routing knowledge (`DecideInput` asks for it): the one
     * repository this endpoint serves. When a payload is readable the
     * engine names the repository from the observation instead; this is
     * the name an unreadable delivery's report carries.
     */
    readonly repository: RepositoryRef;
    readonly worker: string;
    readonly clock: () => Date;
}

/** What every persisted record says about which delivery it answers. */
interface RecordIdentity {
    readonly deliveryId: string;
    readonly event: string;
    readonly receivedAt: string;
    readonly decidedAt: string;
    readonly configRevision: string;
}

/** The canonical shell record persisted for one delivery. */
type ShellRecord =
    | (RecordIdentity & {
          readonly kind: "decision";
          readonly report: Report;
      })
    | (RecordIdentity & {
          /** The config failed to parse. Fail-closed: nothing was decided. */
          readonly kind: "configRejected";
          readonly errors: readonly ConfigError[];
      })
    | (RecordIdentity & {
          /** The runnable shell has no external effect path. */
          readonly kind: "modeUnsupported";
          readonly reason: string;
      });

/**
 * Invalid JSON flows onward as an unreadable payload — the normalizer's
 * `payloadNotObject` names it in the report; the shell has no opinion.
 */
function parsePayload(bytes: Uint8Array): unknown {
    try {
        return JSON.parse(Buffer.from(bytes).toString("utf8"));
        // Stryker disable next-line BlockStatement: an emptied catch falls
        // through to the same implicit undefined — the mutant is equivalent.
    } catch {
        return undefined;
    }
}

/** What the worker exposes: one pass, or pump until the queue is empty. */
export interface Processor {
    processOnce(): Promise<boolean>;
    drain(): Promise<void>;
}

export function createProcessor(options: ProcessorOptions): Processor {
    const { store, capabilities, configSource, externals, repository, worker, clock } = options;
    let draining: Promise<void> | null = null;

    const claimNext = (): ClaimedDelivery | undefined => {
        const now = clock();
        const staleBefore = new Date(now.getTime() - STALE_CLAIM_MINUTES * 60_000);
        return store.claimNextDelivery(worker, now.toISOString(), staleBefore.toISOString());
    };

    /** Station 4: fetch the text, parse it. Every rejection is a value —
     * nothing downstream ever sees a half-read configuration. */
    const loadConfig = async (): Promise<{
        readonly revision: string;
        readonly result: ConfigResult;
    }> => {
        const document = await configSource.load();
        return {
            revision: document.revision,
            result: parseConfigDocument(document.text, {
                revision: document.revision,
                knownCapabilities: capabilities.map((c) => c.declaration.name),
            }),
        };
    };

    const identityFor = (
        claimed: ClaimedDelivery,
        configRevision: string,
        decidedAt: Date,
    ): RecordIdentity => ({
        // The branded GUID becomes plain text here: records are JSON.
        deliveryId: String(claimed.deliveryId),
        event: claimed.eventName,
        receivedAt: claimed.receivedAt,
        decidedAt: decidedAt.toISOString(),
        configRevision,
    });

    /** Stations 5–10 live behind this one call: normalize, evaluate,
     * screen, derive the world, gate. The shell's contribution ends at
     * the parenthesis. */
    const decideOn = async (
        claimed: ClaimedDelivery,
        config: RepositoryConfig,
    ): Promise<Decision> => {
        const payload = parsePayload(claimed.payload);
        // Built per delivery: the live path binds its ordering-evidence
        // memo to exactly this delivery. A rejection here releases the
        // claim like any pre-completion failure, and the delivery retries.
        return decide(
            { kind: "delivery", repository, event: claimed.eventName, payload },
            config,
            capabilities,
            await externals({ payload }),
        );
    };

    /** Build one delivery's canonical record, stations ③ to ⑤ in reading order. */
    const recordFor = async (claimed: ClaimedDelivery): Promise<ShellRecord> => {
        const config = await loadConfig();
        // One instant serves as the record's `decidedAt` AND the gates'
        // clock, so the journal never disagrees with the decision it holds.
        const identity = identityFor(claimed, config.revision, clock());

        if (!config.result.ok) {
            // Fail closed and COMPLETE: redelivering cannot fix a broken
            // config — the fixed file arrives as its own future delivery.
            return { kind: "configRejected", ...identity, errors: config.result.errors };
        }
        if (config.result.config.mode === "active") {
            return {
                kind: "modeUnsupported",
                ...identity,
                reason: "active mode is unsupported by the runnable shell",
            };
        }
        const decision = await decideOn(claimed, config.result.config);
        return { kind: "decision", ...identity, report: decision.report };
    };

    /**
     * Station 3 onward: claim, decide, then atomically persist-and-complete.
     * Failures before canonical completion release the claim.
     */
    const processOnce = async (): Promise<boolean> => {
        const claimed = claimNext();
        if (claimed === undefined) return false;
        try {
            const record = await recordFor(claimed);
            const completion = store.completeDeliveryWithReport({
                deliveryId: claimed.deliveryId,
                eventName: claimed.eventName,
                payloadDigest: claimed.payloadDigest,
                claimToken: claimed.claimToken,
                reportJson: JSON.stringify(record),
                completedAt: clock().toISOString(),
            });
            if (completion.outcome !== "completed") {
                throw new Error(`delivery report was not committed: ${completion.outcome}`);
            }
            return true;
        } catch (error) {
            store.releaseDelivery(claimed.deliveryId, claimed.claimToken);
            throw error;
        }
    };

    return {
        processOnce,
        /** Process until the queue is empty. Overlapping calls share one loop. */
        drain(): Promise<void> {
            draining ??= (async () => {
                try {
                    while (await processOnce());
                } finally {
                    draining = null;
                }
            })();
            return draining;
        },
    };
}
