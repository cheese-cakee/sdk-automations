/**
 * The composition root: receiver + store + processor wired into one running shell.
 * Every box is existing, gated code; this file's whole contribution is ORDER.
 * Plus one clock — a webhook arrival is the only other thing that ever drains, so
 * the sweep is what makes stale work recover on its own in a quiet repository.
 */

import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import {
    validateCapabilityDeclarations,
    type EngineCapability,
    type RepositoryRef,
} from "@hiero-hackers/automation-core";
import type { Store } from "../store/index.js";
import { createReceiver } from "./receiver.js";
import { createProcessor, STALE_CLAIM_MINUTES } from "./processor.js";
import { EFFECT_LEASE_STALE_MINUTES, type Applier } from "./apply.js";
import type { ConfigSource } from "./config.js";
import type { ExternalsForDelivery } from "./externals.js";
import { contained, createLogger, detailOf, type Log } from "./log.js";
import { createSweep, DEFAULT_SWEEP_CADENCE_MS, type SweepFactsSource } from "./sweep.js";

/** How often the shell requeues stale claims and drains, absent an override. */
export const DEFAULT_SWEEP_INTERVAL_MS = 60_000;

/**
 * How long one connection may hold the edge open; Node's defaults are a slow-loris budget.
 * GitHub abandons a delivery unanswered for about ten seconds and redelivers later.
 */
const REQUEST_TIMEOUT_MS = 30_000;
const HEADERS_TIMEOUT_MS = 10_000;

export interface ShellOptions {
    readonly secret: string;
    readonly store: Store;
    readonly capabilities: readonly EngineCapability[];
    readonly configSource: ConfigSource;
    readonly externals: ExternalsForDelivery;
    readonly repository: RepositoryRef;
    readonly worker?: string;
    readonly clock?: () => Date;
    readonly sweepIntervalMs?: number;
    /** The write path, when one is wired; with none, active mode is refused before `decide()`. */
    readonly applier?: Applier;
    /** The fact sweep, when a composition has something to read GitHub with. Absent is the shipped composition: due `sweep:` rows are simply never claimed. */
    readonly sweep?: {
        readonly facts: SweepFactsSource;
        /** How long until the next firing; the default is hourly. */
        readonly cadenceMs?: number;
    };
    /** Optional here and required of every component: the root defaults to the production log. */
    readonly log?: Log;
}

export interface Shell {
    readonly server: Server;
    /** Pump everything pending — exposed so tests and operators drain deterministically. */
    drain(): Promise<void>;
    /** The drain in flight, if there is one. Starts no work. */
    settled(): Promise<void>;
    /** Stop the sweep. The server stays the caller's to close. */
    stopSweep(): void;
}

export function createShell(options: ShellOptions): Shell {
    const errors = validateCapabilityDeclarations(
        options.capabilities.map(({ declaration }) => declaration),
    );
    if (errors.length > 0) {
        throw new Error(`invalid capability declarations: ${errors.join("; ")}`);
    }
    const clock = options.clock ?? (() => new Date());
    const log = contained(options.log ?? createLogger({ clock }));
    const processor = createProcessor({
        store: options.store,
        capabilities: options.capabilities,
        configSource: options.configSource,
        externals: options.externals,
        repository: options.repository,
        worker: options.worker ?? `shell-${randomUUID()}`,
        clock,
        log,
        ...(options.applier === undefined ? {} : { applier: options.applier }),
    });
    /**
     * It rides the reconciliation tick rather than owning a timer: the schedule row's DUE
     * DATE decides when a repository is read, so a second interval is a second thing to stop.
     */
    const factSweep =
        options.sweep === undefined
            ? null
            : createSweep({
                  store: options.store,
                  capabilities: options.capabilities,
                  processor,
                  facts: options.sweep.facts,
                  clock,
                  cadenceMs: options.sweep.cadenceMs ?? DEFAULT_SWEEP_CADENCE_MS,
                  log,
              });
    const handler = createReceiver({
        secret: options.secret,
        log,
        accept: ({ deliveryId, eventName, payload }) =>
            options.store.acceptDelivery({
                deliveryId,
                eventName,
                payload,
                receivedAt: clock().toISOString(),
            }).outcome,
        onAccepted: () => {
            void processor.drain().catch((error: unknown) => {
                log({ event: "drainFailed", phase: "accepted", detail: detailOf(error) });
            });
        },
    });
    /**
     * The effects a worker journalled and never closed.
     * Every row is re-driven through the applier's dispatch, which reads GitHub before it resends, so a sweep can never turn a landed write into a second one.
     */
    const recoverEffects = async (): Promise<void> => {
        const applier = options.applier;
        if (applier === undefined) return;
        const before = new Date(clock().getTime() - EFFECT_LEASE_STALE_MINUTES * 60_000);
        const open = options.store.openIntents(before.toISOString());
        if (open.length === 0) return;
        const config = await processor.configuration();
        if (config === null) return;
        for (const row of open) {
            try {
                await applier.recover(row, config);
            } catch (error) {
                log({
                    event: "sweepFailed",
                    detail: `effect "${row.effectId}" recovery failed: ${detailOf(error)}`,
                });
            }
        }
    };

    /**
     * One tick: hand back dead claims, resolve unclosed effects, pump, fire any due sweep row.
     * Contained, because a throw inside a timer callback takes the process down.
     */
    const reconcile = (): void => {
        try {
            const staleBefore = new Date(clock().getTime() - STALE_CLAIM_MINUTES * 60_000);
            const requeued = options.store.requeueStuckDeliveries(staleBefore.toISOString());
            // A line every interval forever would bury the sweeps that requeued something.

            if (requeued.length > 0) {
                log({
                    event: "sweepRequeued",
                    requeued: requeued.length,
                    deliveryIds: requeued.map(String),
                });
            }
        } catch (error) {
            log({ event: "sweepFailed", detail: detailOf(error) });
            return;
        }
        void recoverEffects().catch((error: unknown) => {
            log({ event: "sweepFailed", detail: detailOf(error) });
        });
        void processor.drain().catch((error: unknown) => {
            log({ event: "drainFailed", phase: "sweep", detail: detailOf(error) });
        });
        // No `.catch`: `runDue` contains its own failures, and a rejection would also
        // reach `settled()`, where a shutdown awaiting it has nowhere to put it.

        void factSweep?.runDue();
    };
    const ticking = setInterval(reconcile, options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS);
    // Stryker disable next-line CallExpression: unref only decides whether an otherwise-idle event loop keeps running; nothing in this process can observe it, and the shell's own exit is explicit.
    // The sweep is recovery, never a reason for the process to stay alive.

    ticking.unref();

    const server = createServer(handler);
    server.requestTimeout = REQUEST_TIMEOUT_MS;
    server.headersTimeout = HEADERS_TIMEOUT_MS;

    return {
        server,
        drain: () => processor.drain(),
        /** BOTH passes, because both hold a claim: the delivery lane's, and the sweep's row. */
        settled: async () => {
            await Promise.all([processor.settled(), factSweep?.settled()]);
        },
        stopSweep: () => {
            clearInterval(ticking);
        },
    };
}
