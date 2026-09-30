/**
 * Every fact group, one module each, and the walks over them (D215). The producer
 * table, the group keys and the fixtures are read off this registry.
 */

import {
    FACT_GROUPS,
    UNREAD,
    type FactGroup,
    type FactKind,
    type Facts,
    type GroupOf,
    type Unread,
} from "../../catalogue.js";
import { assignees } from "./assignees.js";
import { links } from "./links.js";
import { locked } from "./locked.js";
import type {
    GroupDelivery,
    GroupMissingCode,
    GroupModule,
    GroupValue,
    ProducerName,
    WebhookProducer,
} from "./module.js";
import { readiness } from "./readiness.js";
import { review } from "./review.js";
import { skills } from "./skills.js";

export * from "./module.js";

/** The only place the groups are listed; a group with no module fails to compile here. */
export const GROUPS = {
    locked,
    skills,
    assignees,
    links,
    review,
    readiness,
} as const satisfies { readonly [G in FactGroup]: GroupModule<G> };

/** One module, widened so a walk can index it with a variable. */
interface WideModule {
    readonly readBy: Partial<Readonly<Record<FactKind, readonly ProducerName[]>>>;
    readonly fromDelivery?: (delivery: GroupDelivery) => unknown;
    readonly missing?: { readonly code: GroupMissingCode; readonly detail: string };
    readonly kept?: Partial<Readonly<Record<FactKind, (value: unknown) => unknown>>>;
    readonly fixture: Partial<Readonly<Record<FactKind, unknown>>>;
}

const moduleOf = (group: FactGroup): WideModule => GROUPS[group];

/** The producers that read this group on this kind; empty for a kind that does not carry it. */
export function readersOf(kind: FactKind, group: FactGroup): readonly ProducerName[] {
    return moduleOf(group).readBy[kind] ?? [];
}

/** Does this kind carry the group at all? */
export function carriesFactGroup(kind: FactKind, group: FactGroup): boolean {
    return moduleOf(group).readBy[kind] !== undefined;
}

/** Did the producer leave this group unread? `false` for a group the kind does not carry. */
export function factGroupUnread(facts: Facts, group: FactGroup): boolean {
    return (
        carriesFactGroup(facts.kind, group) &&
        (facts as unknown as Readonly<Record<string, unknown>>)[group] === UNREAD
    );
}

/** The groups the sweep keeps on this kind between firings (D193), in `FACT_GROUPS` order. */
export function keptOn(kind: FactKind): readonly FactGroup[] {
    return FACT_GROUPS.filter((group) => moduleOf(group).kept?.[kind] !== undefined);
}

/** A kept group's stored value read back: the value, `UNREAD`, or `null` for a shape nobody wrote. */
export function decodeKept(kind: FactKind, group: FactGroup, value: unknown): unknown {
    if (value === UNREAD) return UNREAD;
    return moduleOf(group).kept?.[kind]?.(value) ?? null;
}

/** What a fixture's producer read for this group on this kind. */
export function fixtureOf(kind: FactKind, group: FactGroup): unknown {
    return moduleOf(group).fixture[kind];
}

/** The producers the module for `G` names on kind `K`, as a union. */
type ReadersOf<G extends FactGroup, K extends FactKind> = (typeof GROUPS)[G]["readBy"] extends {
    readonly [P in K]: readonly (infer R)[];
}
    ? R
    : never;

/** The groups producer `P` reads on kind `K`, as a union of their names. */
export type GroupsReadBy<P extends ProducerName, K extends FactKind> = {
    [G in FactGroup]: P extends ReadersOf<G, K> ? G : never;
}[FactGroup];

/** The groups kept on kind `K`, as a union. */
export type KeptOn<K extends FactKind> = {
    [G in FactGroup]: (typeof GROUPS)[G] extends { readonly kept: { readonly [P in K]: unknown } }
        ? G
        : never;
}[FactGroup];

/** A `K` record's kept groups, as a stored read hands them back — one definition (D216). */
export type KeptGroups<K extends FactKind> = {
    readonly [G in KeptOn<K>]: GroupValue<K, G> | Unread;
};

/** The groups of a `K` record as producer `P` fills them: its own read, every other `Unread`. */
export type DeliveredGroups<P extends ProducerName, K extends FactKind> = {
    readonly [G in GroupOf<K>]: G extends GroupsReadBy<P, K> ? GroupValue<K, G> : Unread;
};

/** A webhook's groups for one record, or the group its payload lacked. */
export type Delivered<P extends WebhookProducer, K extends FactKind> =
    | { readonly ok: true; readonly groups: DeliveredGroups<P, K> }
    | { readonly ok: false; readonly code: GroupMissingCode; readonly detail: string };

/**
 * Every group a `K` record carries, as webhook producer `P` fills it: read from the
 * payload where `P` reads it, `Unread` otherwise. THE ONE CAST: the loop fills
 * exactly the keys `DeliveredGroups` names, from the same registry.
 */
export function deliveredGroups<P extends WebhookProducer, K extends FactKind>(
    producer: P,
    kind: K,
    delivery: GroupDelivery,
): Delivered<P, K> {
    const groups: Record<string, unknown> = {};
    for (const group of FACT_GROUPS) {
        if (!carriesFactGroup(kind, group)) continue;
        const module = moduleOf(group);
        if (!readersOf(kind, group).includes(producer) || module.fromDelivery === undefined) {
            groups[group] = UNREAD;
            continue;
        }
        const value = module.fromDelivery(delivery);
        if (value !== null) {
            groups[group] = value;
            continue;
        }
        // A payload without the group refuses the delivery where the module says so, and is unread otherwise.
        if (module.missing === undefined) {
            groups[group] = UNREAD;
            continue;
        }
        return {
            ok: false,
            code: module.missing.code,
            detail: `${producer}: ${module.missing.detail}`,
        };
    }
    return { ok: true, groups: groups as DeliveredGroups<P, K> };
}
