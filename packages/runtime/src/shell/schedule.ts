/**
 * When a repository wants sweeping, what its schedule row is called, and what
 * one swept item's record is called — `design/guides/sweep.md` §2.
 *
 * Its own module because TWO files need every answer here and neither may
 * import the other: the processor declares the row (it is the lane that reads
 * the configuration on every delivery), and the driver claims it. A spelling
 * kept in both would be a spelling that could drift, and a drifted schedule id
 * is a sweep that arms one row and claims another forever.
 *
 * Nothing here decides anything. The judgement below is a membership test the
 * declaration and the driver's first gate ask in the same words.
 */

import type {
    EngineCapability,
    RepositoryConfig,
    ItemRef,
    RepositoryRef,
} from "@hiero-hackers/automation-core";
import type { Store } from "../store/index.js";

/**
 * The `effect` column every sweep row carries, and the `event` the records of
 * one firing are stamped with. One word for both because they are one fact:
 * this row, and everything it produced, is the sweep.
 */
export const SWEEP_EFFECT = "sweep";

/** The one spelling of a repository's sweep row. */
export function sweepScheduleId(repository: RepositoryRef): string {
    return `${SWEEP_EFFECT}:${repository.owner}/${repository.repo}`;
}

/**
 * One swept item's synthetic delivery id — `sweep:{schedule}:{item}`.
 *
 * A NAME, never a durable delivery: the store keys deliveries by GitHub's own
 * GUID, so minting one here would file an event GitHub never sent in the
 * deduplication table. It exists so that a report, a log line and an operator's
 * grep can all say which item of which firing they are about.
 */
export function sweptItemId(scheduleId: string, item: ItemRef): string {
    return `${scheduleId}:${item.kind}#${String(item.number)}`;
}

/**
 * Does this repository enable a capability that runs on a clock?
 *
 * The whole question the sweep exists for. A repository that enables none is
 * one the sweep completes and re-arms without reading anything — the reads are
 * the expensive part, and nothing would consume them.
 */
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
 * Declare the repository's sweep row, if it wants one — idempotently, on every
 * delivery, because the processor is the lane that has just read the file.
 *
 * Due NOW rather than a cadence from now: the cadence belongs to the driver,
 * which may not even be composed in this process, and the row is a standing
 * statement that this repository wants sweeping rather than a promise about
 * when. A composition with no driver simply never claims it; one that gains a
 * driver later finds it waiting.
 *
 * `Store.schedule` is `INSERT OR IGNORE`, so the second delivery and the
 * ten-thousandth change nothing — including the due instant, which belongs to
 * whoever last completed a firing.
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
