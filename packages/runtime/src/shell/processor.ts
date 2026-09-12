/**
 * The worker half: claim a durable delivery, prepare, reject an unsupported mode or
 * call the one verb, apply what it approved, then commit the outcome with completion.
 * The reading key: a claimed delivery always ends as exactly ONE of four records —
 * `repositoryMismatch`, `configRejected`, `modeUnsupported`, or a decision, with no
 * fifth exit. The try/catch in `attemptNext` is routing, not handling.
 */

import {
    decide,
    parseConfigDocument,
    repositoryNamedBy,
    UNREADABLE_CONFIG_REVISION,
    type ConfigResult,
    type ConfigError,
    type Decision,
    type EngineCapability,
    type Facts,
    type Report,
    type RepositoryConfig,
    type RepositoryRef,
} from "@hiero-hackers/automation-core";
import type { ClaimedDelivery, ReleaseDeliveryAfterFailureResult, Store } from "../store/index.js";
import type { Applier } from "./apply.js";
import type { ConfigSource } from "./config.js";
import type { EffectOutcome } from "./effects.js";
import { recordedWarningsIn, type ExternalsForDelivery } from "./externals.js";
import { detailOf, type Log } from "./log.js";
import { declareSweep, SWEEP_EFFECT } from "./schedule.js";

/**
 * A processing claim older than this is presumed dead and taken over.
 * Exported for the sweep in `shell.ts`, which requeues on the same clock.
 */
export const STALE_CLAIM_MINUTES = 15;

/**
 * The retry bounds: five attempts in all, waiting 30s, 60s, 120s and 240s between.
 * The hourly ceiling bounds the doubling rather than being a number this reaches.
 */
const MAX_DELIVERY_ATTEMPTS = 5;
const RETRY_BASE_MS = 30_000;
const RETRY_CEILING_MS = 60 * 60_000;

/** The wait a delivery earns after `attempts` failures, doubling each time. */
function retryDelayMs(attempts: number): number {
    return Math.min(RETRY_BASE_MS * 2 ** attempts, RETRY_CEILING_MS);
}

/** Dependencies and operator hooks for one durable delivery worker. */
export interface ProcessorOptions {
    readonly store: Store;
    readonly capabilities: readonly EngineCapability[];
    readonly configSource: ConfigSource;
    readonly externals: ExternalsForDelivery;
    /** The one repository this endpoint serves, and the name every payload is held to. */
    readonly repository: RepositoryRef;
    readonly worker: string;
    readonly clock: () => Date;
    /** Every line here names its delivery: this is the lane that retries. */
    readonly log: Log;
    /** The write path, when a composition root has wired one. Absent is the shipped composition, so `mode: active` ends as `modeUnsupported` before `decide()` runs — the shell genuinely has no effect path. */
    readonly applier?: Applier;
}

/** What every persisted record says about which delivery it answers. */
interface RecordIdentity {
    readonly deliveryId: string;
    readonly event: string;
    readonly receivedAt: string;
    readonly decidedAt: string;
    readonly configRevision: string;
}

/**
 * The canonical shell record persisted for one delivery — and a swept item's, which
 * is the same shape because a sweep is a second CALLER of `decide()` (facts.md §4).
 */
export type ShellRecord =
    | (RecordIdentity & {
          readonly kind: "decision";
          readonly report: Report;
          /** What became of each approved effect. Empty outside active mode. */
          readonly effects: readonly EffectOutcome[];
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
      })
    | (RecordIdentity & {
          /** The payload names a repository this endpoint does not serve. */
          readonly kind: "repositoryMismatch";
          /** `owner/repo`, as configured and as the payload named it. */
          readonly expected: string;
          readonly observed: string;
      });

/** Stamped when a record was reached without consulting the configuration. */
const CONFIG_NOT_CONSULTED_REVISION = "sha256:unconsulted";

/** Invalid JSON flows onward as an unreadable payload; the shell has no opinion. */
function parsePayload(bytes: Uint8Array): unknown {
    try {
        return JSON.parse(Buffer.from(bytes).toString("utf8"));
        // Stryker disable next-line BlockStatement: an emptied catch falls through to the same implicit undefined — the mutant is equivalent.
    } catch {
        return undefined;
    }
}

/** The `owner/repo` a payload names, read via core's `repositoryNamedBy`. */
function repositorySpelledBy(payload: unknown): string | null {
    const named = repositoryNamedBy(payload);
    return named === null ? null : `${named.owner}/${named.repo}`;
}

/** Case-insensitively, because GitHub's names are: no two repositories differ only in case. */
function sameRepository(named: string, served: string): boolean {
    return named.toLowerCase() === served.toLowerCase();
}

/**
 * One fact record to decide about, outside the delivery queue — the sweep's entry to
 * the lifecycle this file owns (sweep.md §2). `deliveryId` is a NAME, never a durable row. The configuration is passed in because the sweep reads it ONCE per firing.
 */
export interface FactRecordInput {
    readonly facts: Facts;
    readonly deliveryId: string;
    /** When the firing this record belongs to became due. */
    readonly receivedAt: string;
    readonly config: RepositoryConfig;
}

/** What the worker exposes: one pass, or pump until the queue is empty. */
export interface Processor {
    processOnce(): Promise<boolean>;
    drain(): Promise<void>;
    /**
     * Decide one fact record and apply what it approved — stations ④ to ⑥ for a caller
     * that already holds the record and the configuration. ONE lifecycle, not two.
     */
    processFacts(input: FactRecordInput): Promise<ShellRecord>;
    /** The drain in flight, if any; resolved at once when none is. */
    settled(): Promise<void>;
    /**
     * The current configuration as this lane reads it, or `null` when it cannot be read.
     * Exposed for the sweep's effect recovery, so a resend is gated on the same file: two readers could disagree about active mode, and that disagreement writes to GitHub.
     */
    configuration(): Promise<RepositoryConfig | null>;
}

/**
 * What one claimed-and-carried delivery came to.
 * The failure case is a VALUE, because the drain has to keep going after it.
 */
type PassOutcome =
    | { readonly kind: "idle" }
    | { readonly kind: "completed" }
    | {
          readonly kind: "failed";
          readonly deliveryId: string;
          readonly error: unknown;
          readonly release: ReleaseDeliveryAfterFailureResult;
      };

/**
 * What the failure did to the delivery, as the fields its line carries.
 * `attempts` is `null` for exactly one disposition: a lost claim counts nothing.
 */
function dispositionOf(release: ReleaseDeliveryAfterFailureResult): {
    readonly disposition: ReleaseDeliveryAfterFailureResult["outcome"];
    readonly attempts: number | null;
    readonly maxAttempts: number;
    readonly retryNotBefore: string | null;
} {
    const common = { disposition: release.outcome, maxAttempts: MAX_DELIVERY_ATTEMPTS };
    switch (release.outcome) {
        case "retryScheduled":
            return {
                ...common,
                attempts: release.attempts,
                retryNotBefore: release.retryNotBefore,
            };
        case "deadLettered":
            return { ...common, attempts: release.attempts, retryNotBefore: null };
        case "notOwned":
            return { ...common, attempts: null, retryNotBefore: null };
    }
}

export function createProcessor(options: ProcessorOptions): Processor {
    const {
        store,
        capabilities,
        configSource,
        externals,
        repository,
        worker,
        clock,
        log,
        applier,
    } = options;
    let draining: Promise<void> | null = null;

    const claimNext = (): ClaimedDelivery | undefined => {
        const now = clock();
        const staleBefore = new Date(now.getTime() - STALE_CLAIM_MINUTES * 60_000);
        return store.claimNextDelivery(worker, now.toISOString(), staleBefore.toISOString());
    };

    /** Station 4: fetch the text, parse it. Every rejection is a value. */
    const loadConfig = async (): Promise<{
        readonly revision: string;
        readonly result: ConfigResult;
    }> => {
        const loaded = await configSource.load();
        if (!loaded.ok) {
            if (loaded.permanent) {
                return {
                    revision: loaded.revision ?? UNREADABLE_CONFIG_REVISION,
                    result: {
                        ok: false,
                        // documentUnparseable, not a new code: the catalogue only admits codes a DOCUMENT can reach (D76).

                        errors: [
                            {
                                code: "documentUnparseable",
                                message: `unreadable before parsing: ${loaded.detail}`,
                                path: null,
                            },
                        ],
                    },
                };
            }
            // Transient: the throw costs one attempt and schedules the next, so a config
            // unreachable for good dead-letters instead of retrying without end.

            throw new Error(`configuration unavailable: ${loaded.detail}`);
        }
        const { document } = loaded;
        return {
            revision: document.revision,
            result: parseConfigDocument(document.text, {
                revision: document.revision,
                // Full declarations, not names: the parser reads each settings block against its own spec.

                knownCapabilities: capabilities.map((c) => c.declaration),
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

    /** Stations 5–10 live behind one call: normalize, evaluate, screen, derive, gate. */
    const decideOn = async (
        claimed: ClaimedDelivery,
        payload: unknown,
        config: RepositoryConfig,
    ): Promise<Decision> => {
        // Built per delivery: the live path binds its ordering-evidence memo to this one.

        const facts = await externals({
            payload,
            deliveryId: String(claimed.deliveryId),
            config,
        });
        return decide(
            { kind: "delivery", repository, event: claimed.eventName, payload },
            config,
            capabilities,
            // The recorded warning is the store's, not the delivery's, so every composition
            // that owns a store can answer it, credentials or not (grace.md §2).

            { ...facts, warningFor: recordedWarningsIn(store) },
        );
    };

    /**
     * Stations ④ to ⑥ over a configuration that has already parsed.
     * BOTH callers end here, which is what makes "one lifecycle" true rather than said: the write path is acquired in one place.
     */
    const decidedRecord = async (
        identity: RecordIdentity,
        config: RepositoryConfig,
        decideIt: () => Promise<Decision>,
    ): Promise<ShellRecord> => {
        const active = config.mode === "active";
        if (active && applier === undefined) {
            return {
                kind: "modeUnsupported",
                ...identity,
                reason: "active mode is unsupported by the runnable shell",
            };
        }
        const decision = await decideIt();
        // Only in active mode, so a future mode cannot acquire a write path by accident.

        const effects =
            active && applier !== undefined
                ? await applier.applyAll(decision.approved, config)
                : [];
        return { kind: "decision", ...identity, report: decision.report, effects };
    };

    const served = `${repository.owner}/${repository.repo}`;

    /**
     * Build one delivery's canonical record, stations ③ to ⑤ in reading order.
     * The repository comes FIRST, before the configuration is read: a payload naming another is a permanent property of the bytes, so a config outage cannot turn a refusal into four retries and a dead letter.
     */
    const recordFor = async (claimed: ClaimedDelivery): Promise<ShellRecord> => {
        const payload = parsePayload(claimed.payload);
        const named = repositorySpelledBy(payload);
        if (named !== null && !sameRepository(named, served)) {
            return {
                kind: "repositoryMismatch",
                ...identityFor(claimed, CONFIG_NOT_CONSULTED_REVISION, clock()),
                expected: served,
                observed: named,
            };
        }
        const config = await loadConfig();
        // One instant is the record's `decidedAt` AND the gates' clock, so the journal
        // never disagrees with the decision it holds.

        const identity = identityFor(claimed, config.revision, clock());

        if (!config.result.ok) {
            // Fail closed and COMPLETE: the fixed file arrives as its own future delivery.

            return { kind: "configRejected", ...identity, errors: config.result.errors };
        }
        const parsed = config.result.config;
        // The one thing this lane does for the OTHER one: the sweep row is declared
        // here, because this is where the file is read (sweep.md §2, step 1).

        declareSweep({ store, repository, config: parsed, capabilities, now: clock() });
        return decidedRecord(identity, parsed, () => decideOn(claimed, payload, parsed));
    };

    /**
     * Count one failed attempt, which either spaces the next or ends the delivery.
     * The wait is derived from the attempts the claim arrived with.
     */
    const recordFailure = (claimed: ClaimedDelivery): ReleaseDeliveryAfterFailureResult => {
        const failedAt = clock();
        return store.releaseDeliveryAfterFailure({
            deliveryId: claimed.deliveryId,
            claimToken: claimed.claimToken,
            failedAt: failedAt.toISOString(),
            retryNotBefore: new Date(
                failedAt.getTime() + retryDelayMs(claimed.attempts),
            ).toISOString(),
            maxAttempts: MAX_DELIVERY_ATTEMPTS,
        });
    };

    /**
     * Station 3 onward: claim, decide, then atomically persist-and-complete.
     * A failure before canonical completion is counted, not just released.
     */
    const attemptNext = async (): Promise<PassOutcome> => {
        const claimed = claimNext();
        if (claimed === undefined) return { kind: "idle" };
        const deliveryId = String(claimed.deliveryId);
        log({
            event: "deliveryClaimed",
            deliveryId,
            eventName: claimed.eventName,
            attempts: claimed.attempts,
        });
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
            log({ event: "deliveryCompleted", deliveryId, kind: record.kind });
            return { kind: "completed" };
        } catch (error) {
            const release = recordFailure(claimed);
            log({
                event: "deliveryAttemptFailed",
                deliveryId,
                ...dispositionOf(release),
                detail: detailOf(error),
            });
            // A second line, because this is where a delivery STOPS.

            if (release.outcome === "deadLettered") {
                log({ event: "deliveryDeadLettered", deliveryId, attempts: release.attempts });
            }
            return { kind: "failed", deliveryId, error, release };
        }
    };

    return {
        /** One swept item, decided and applied. No claim of its own: the sweep holds the row. */
        processFacts({ facts, deliveryId, receivedAt, config }): Promise<ShellRecord> {
            return decidedRecord(
                {
                    deliveryId,
                    event: SWEEP_EFFECT,
                    receivedAt,
                    decidedAt: clock().toISOString(),
                    configRevision: config.revision,
                },
                config,
                async () =>
                    decide({ kind: "facts", facts }, config, capabilities, {
                        // No payload: a sweep has no causing human action to exclude.

                        ...(await externals({ payload: undefined, deliveryId, config })),
                        warningFor: recordedWarningsIn(store),
                    }),
            );
        },

        /** One pass. A failed delivery still throws: the caller asked for it. */
        async processOnce(): Promise<boolean> {
            const outcome = await attemptNext();
            if (outcome.kind === "failed") throw outcome.error;
            return outcome.kind === "completed";
        },
        /**
         * Process until the queue is empty, stepping OVER a failed delivery: it is backed
         * off or dead-lettered by then. The one failure that ends the pass early is a lost claim — the attempt went uncounted, so a loop that cannot prove progress stops.
         */
        drain(): Promise<void> {
            draining ??= (async () => {
                try {
                    for (;;) {
                        const outcome = await attemptNext();
                        if (outcome.kind === "idle") return;
                        // Already logged where the store's answer was known; here it is only routing.

                        if (outcome.kind === "failed" && outcome.release.outcome === "notOwned") {
                            return;
                        }
                    }
                } finally {
                    draining = null;
                }
            })();
            return draining;
        },
        /**
         * What a shutdown waits for. It cannot be `drain()`: with no pass in flight that
         * would START one, claiming work the process is about to walk away from.
         */
        settled(): Promise<void> {
            return draining ?? Promise.resolve();
        },
        /**
         * A read, never a decision: an unanswerable source and an unparsable file are both
         * `null`, because the sweep's response to either is the same.
         */
        async configuration(): Promise<RepositoryConfig | null> {
            try {
                const loaded = await loadConfig();
                return loaded.result.ok ? loaded.result.config : null;
            } catch {
                return null;
            }
        },
    };
}
