/** When a repository wants sweeping, and what its schedule row and records are called (sweep.md §2). */

import type {
    EngineCapability,
    RepositoryConfig,
    ItemRef,
    RepositoryRef,
} from "@hiero-hackers/automation-core";
import type { Store } from "../store/index.js";

/** The `effect` column every sweep row carries, and the `event` its records are stamped with. */
export const SWEEP_EFFECT = "sweep";

/** The one spelling of a repository's sweep row. */
export function sweepScheduleId(repository: RepositoryRef): string {
    return `${SWEEP_EFFECT}:${repository.owner}/${repository.repo}`;
}

/**
 * One swept item's synthetic delivery id — `sweep:{schedule}:{item}`.
 * A NAME, never a durable delivery: the store keys deliveries by GitHub's own GUID.
 */
export function sweptItemId(scheduleId: string, item: ItemRef): string {
    return `${scheduleId}:${item.kind}#${String(item.number)}`;
}

/** Does this repository enable a capability that runs on a clock? */
export function wantsSweeping(
    config: RepositoryConfig,
    capabilities: readonly EngineCapability[],
): boolean {
    return capabilities.some(
        ({ declaration }) =>
            config.capabilities[declaration.name]?.enabled === true &&
            declaration.triggers.some((trigger) => trigger.kind === "schedule"),
    );
}

/** Everything the declaration below needs; the processor holds all of it. */
export interface SweepDeclaration {
    readonly store: Store;
    readonly repository: RepositoryRef;
    readonly config: RepositoryConfig;
    readonly capabilities: readonly EngineCapability[];
    readonly now: Date;
}

/**
 * Declare the repository's sweep row if it wants one — idempotently, on every delivery.
 * Due NOW rather than a cadence from now: the cadence belongs to the driver.
 */
export function declareSweep({
    store,
    repository,
    config,
    capabilities,
    now,
}: SweepDeclaration): void {
    if (!wantsSweeping(config, capabilities)) return;
    store.schedule(sweepScheduleId(repository), now.toISOString(), SWEEP_EFFECT);
}
