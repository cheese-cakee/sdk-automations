/** One fact group in the sweep: the confirmed reads it is built from, and its read per kind (D216). */

import type {
    AssigneeClock,
    FactGroup,
    FactKind,
    GroupOf,
    GroupValue,
    ItemRef,
    Unread,
} from "@hiero-hackers/automation-core";
import type { ClosedIssues, ItemWalk, OpenItem, Read, ReadContext, SweepRead } from "../items.js";

/** What one item's reads may use: its row, the firing's memos, and what only the driver holds. */
export interface GroupScope {
    readonly listed: OpenItem;
    readonly context: ReadContext;
    readonly walk: ItemWalk;
    clocksFor(item: ItemRef, logins: readonly string[]): Promise<Read<readonly AssigneeClock[]>>;
    /** An issue's open pull requests, the inverse of every pull request's closing references. */
    readonly openPullRequests: readonly ItemRef[] | Unread;
    /** A pull request's closing references, and the listed issues they join. */
    readonly closes: ClosedIssues;
    readonly openIssues: readonly OpenItem[];
}

export interface SweepGroup<G extends FactGroup> {
    /** The matrix-confirmed reads it is built from; `[]` rides on the list and is always read. */
    readonly reads: readonly SweepRead[];
    readonly read: {
        readonly [K in FactKind as G extends GroupOf<K> ? K : never]-?: (
            scope: GroupScope,
        ) => Promise<Read<GroupValue<K, G>>>;
    };
}
