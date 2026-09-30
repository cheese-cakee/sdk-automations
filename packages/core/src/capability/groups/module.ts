/** One fact group in core: who reads it on which kind, its webhook read, its fixture (D215). */

import type { FactGroup, FactKind, Facts, GroupOf, Unread } from "../../catalogue.js";
import type { Skill } from "../../config/index.js";

export const WEBHOOK_PRODUCERS = ["issues", "issue_comment", "pull_request"] as const;

export type WebhookProducer = (typeof WEBHOOK_PRODUCERS)[number];

/** The sweep is the one producer that is not an event. */
export const PRODUCER_NAMES = [...WEBHOOK_PRODUCERS, "sweep"] as const;

export type ProducerName = (typeof PRODUCER_NAMES)[number];

/** The kinds each producer makes a record of; a group row names none outside them. */
export const PRODUCER_KINDS = {
    issues: ["issue"],
    issue_comment: ["issue"],
    pull_request: ["pullRequest"],
    sweep: ["issue", "pullRequest"],
} as const satisfies { readonly [P in ProducerName]: readonly FactKind[] };

/** A group's value on kind `K`, read. */
export type GroupValue<K extends FactKind, G extends FactGroup> = Exclude<
    Extract<Facts, { kind: K }>[G & keyof Extract<Facts, { kind: K }>],
    Unread
>;

export type AnyGroupValue<G extends FactGroup> = {
    [K in FactKind]: G extends GroupOf<K> ? GroupValue<K, G> : never;
}[FactKind];

/** What a webhook read may use: the item as the payload holds it, and the preamble's readings. */
export interface GroupDelivery {
    readonly item: Record<string, unknown>;
    readonly skills: readonly Skill[];
}

/** Engine refusal codes, spelled here; `malformed()` fails to compile if one drifts. */
export type GroupMissingCode = "lockedMissing" | "draftMissing";

export interface GroupModule<G extends FactGroup> {
    /** Every kind that carries the group, and no other: the producers that read it there. */
    readonly readBy: {
        readonly [K in FactKind as G extends GroupOf<K> ? K : never]-?: readonly ProducerName[];
    };
    /** Present when a webhook reads the group; `null` when the payload lacks it. */
    readonly fromDelivery?: (delivery: GroupDelivery) => AnyGroupValue<G> | null;
    readonly missing?: { readonly code: GroupMissingCode; readonly detail: string };
    /** Per kind the sweep keeps it between firings (D193): its stored value read back, `null` for another shape. */
    readonly kept?: {
        readonly [K in FactKind as G extends GroupOf<K> ? K : never]?: (
            value: unknown,
        ) => GroupValue<K, G> | null;
    };
    /** The smallest true answer, per kind. */
    readonly fixture: {
        readonly [K in FactKind as G extends GroupOf<K> ? K : never]-?: GroupValue<K, G>;
    };
}
