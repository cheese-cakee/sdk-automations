/**
 * Who reads what: every producer of fact records, and the groups each fills.
 * THE TABLE IS THE PROMISE — a failed read still leaves its group `"unread"`.
 */

import type { FactGroup, FactKind, Facts, Unread } from "../catalogue.js";

/** The producers that wake on a webhook delivery — and so the events core consumes. */
export const WEBHOOK_PRODUCERS = ["issues", "issue_comment", "pull_request"] as const;

export type WebhookProducer = (typeof WEBHOOK_PRODUCERS)[number];

/** Every producer. The sweep is the one that is not an event. */
export const PRODUCER_NAMES = [...WEBHOOK_PRODUCERS, "sweep"] as const;

export type ProducerName = (typeof PRODUCER_NAMES)[number];

/** Per producer and kind, the groups it reads — `null` for no record at all (D76). */
type ProducerTable = {
    readonly [P in ProducerName]: { readonly [K in FactKind]: readonly FactGroup[] | null };
};

/** The registry. `satisfies`, not a `:` annotation, which would widen every row. */
export const PRODUCERS = {
    issues: { issue: [], pullRequest: null },
    // The payload's assignee list carries no clocks, and no `merged` (D47).
    issue_comment: { issue: ["command"], pullRequest: null },
    // `draft` arrives whole; the facts left in `review` need the timeline.
    pull_request: { issue: null, pullRequest: ["readiness"] },
    sweep: {
        issue: ["assignees", "links"],
        pullRequest: ["assignees", "links", "review", "readiness"],
    },
} as const satisfies ProducerTable;

/** The same table widened, so the questions below can index it with a variable. */
const ROWS: ProducerTable = PRODUCERS;

function isName<T extends string>(names: readonly T[], name: string): name is T {
    return names.some((known) => known === name);
}

export function isWebhookProducer(name: string): name is WebhookProducer {
    return isName(WEBHOOK_PRODUCERS, name);
}

export function producesKind(producer: ProducerName, kind: FactKind): boolean {
    return ROWS[producer][kind] !== null;
}

export function producerReads(producer: ProducerName, kind: FactKind, group: FactGroup): boolean {
    return ROWS[producer][kind]?.includes(group) ?? false;
}

/** The producers that do read this group — what a boot refusal names instead. */
export function producersReading(kind: FactKind, group: FactGroup): readonly ProducerName[] {
    return PRODUCER_NAMES.filter((producer) => producerReads(producer, kind, group));
}

/** The groups producer `P` reads on kind `K`, as a union of their names. */
export type GroupsReadBy<
    P extends ProducerName,
    K extends FactKind,
> = (typeof PRODUCERS)[P][K] extends readonly (infer G extends FactGroup)[] ? G : never;

/** One record with the named groups read, every other group `Unread` — facts.md §3. */
export type ReadGroups<F extends Facts, N extends FactGroup> = {
    readonly [K in keyof F]: K extends N
        ? Exclude<F[K], Unread>
        : K extends FactGroup
          ? Unread
          : F[K];
};

/** The record shape producer `P` may build for kind `K`; the row it omits is `Unread`. */
export type ProducedFacts<
    P extends ProducerName,
    K extends FactKind,
> = (typeof PRODUCERS)[P][K] extends readonly FactGroup[]
    ? ReadGroups<Extract<Facts, { kind: K }>, GroupsReadBy<P, K>>
    : never;
