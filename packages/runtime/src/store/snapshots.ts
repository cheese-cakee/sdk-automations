/**
 * What one item's read left behind, and the row it becomes: instants as ISO
 * strings, an unread group as the sentinel (D193). Nothing here throws — bytes
 * that are not this file's own decode to `null`, and the read rewrites them.
 */

import {
    decodeKept,
    ENTITY_KINDS,
    FACT_GROUPS,
    keptOn,
    UNREAD,
    type FactGroup,
    type FactKind,
    type ItemRef,
    type KeptGroups,
    type RepositoryRef,
    type Unread,
} from "@hiero-hackers/automation-core";

// ─── What a read leaves behind ───────────────────────────────────────

/** An issue's kept groups; its `links` are the inverse, rebuilt every firing. */
export type StoredIssueFacts = KeptGroups<"issue">;

/** A pull request's kept groups, with the batch answer its links were built from. */
export type StoredPullRequestFacts = KeptGroups<"pullRequest"> & {
    readonly closes: readonly ItemRef[] | Unread;
};

/** One item's read: the groups it was read with, and what each of them said. */
export type SnapshotFacts = { readonly groups: readonly FactGroup[] } & (
    | ({ readonly kind: "issue" } & StoredIssueFacts)
    | ({ readonly kind: "pullRequest" } & StoredPullRequestFacts)
);

/** One `item_snapshot` row: the read, and the two instants the reuse rule compares. */
export interface ItemSnapshot {
    readonly item: ItemRef;
    /** The open-item list's own field at that read. */
    readonly updatedAt: string;
    readonly readAt: string;
    /** `encodeSnapshot`'s JSON; `decodeSnapshot` is its only reader. */
    readonly facts: string;
}

/** How many reads one repository holds, and the oldest of them (D168, D193). */
export interface SnapshotStanding {
    readonly repository: RepositoryRef;
    readonly count: number;
    readonly oldest: string;
}

// ─── The codec ───────────────────────────────────────────────────────

/** The stored groups as one column. A `Date` writes itself as the ISO instant. */
export function encodeSnapshot(facts: SnapshotFacts): string {
    return JSON.stringify(facts);
}

const recordOf = (value: unknown): Record<string, unknown> | null =>
    typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;

/** A group's value, or the sentinel; `null` is a shape this file did not write. */
function groupOf<T>(value: unknown, read: (value: unknown) => T | null): T | Unread | null {
    return value === UNREAD ? UNREAD : read(value);
}

function itemOf(value: unknown): ItemRef | null {
    const ref = recordOf(value);
    const kind = ENTITY_KINDS.find((named) => named === ref?.["kind"]);
    const number = ref?.["number"];
    return kind === undefined || typeof number !== "number" || !Number.isSafeInteger(number)
        ? null
        : { kind, number };
}

/** Every entry of an array read by one reader, or `null` if any entry is not that shape. */
function each<T>(value: unknown, read: (entry: unknown) => T | null): readonly T[] | null {
    if (!Array.isArray(value)) return null;
    const entries: T[] = [];
    for (const entry of value) {
        const one = read(entry);
        if (one === null) return null;
        entries.push(one);
    }
    return entries;
}

const groupNameOf = (value: unknown): FactGroup | null =>
    FACT_GROUPS.find((group) => group === value) ?? null;

/** Every kept group of one kind, decoded through its module, or `null` on any one of them. */
function keptOf(kind: FactKind, stored: Record<string, unknown>): Record<string, unknown> | null {
    const groups: Record<string, unknown> = {};
    for (const group of keptOn(kind)) {
        const value = decodeKept(kind, group, stored[group]);
        if (value === null) return null;
        groups[group] = value;
    }
    return groups;
}

/** One row's groups as the reader takes them back, or `null` for a row nobody can read. */
export function decodeSnapshot(stored: string): SnapshotFacts | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(stored);
    } catch {
        return null;
    }
    const facts = recordOf(parsed);
    const groups = each(facts?.["groups"], groupNameOf);
    if (facts === null || groups === null) return null;
    const kind = ENTITY_KINDS.find((named) => named === facts["kind"]);
    if (kind === undefined) return null;
    const kept = keptOf(kind, facts);
    if (kept === null) return null;
    if (kind === "issue") return { kind, groups, ...kept } as SnapshotFacts;
    const closes = groupOf(facts["closes"], (value) => each(value, itemOf));
    return closes === null ? null : ({ kind, groups, ...kept, closes } as SnapshotFacts);
}

// ─── Whether a stored read still stands ──────────────────────────────

/**
 * Does this read answer what the repository needs now — the same groups, each kept one read?
 * A set that moved since the read, or a group that read failed on, is a miss rather than a stale answer (D193).
 */
export function snapshotAnswers(stored: SnapshotFacts, needed: readonly FactGroup[]): boolean {
    if (stored.groups.join(",") !== needed.join(",")) return false;
    const held = stored as unknown as Readonly<Record<string, unknown>>;
    return keptOn(stored.kind).every((group) => !needed.includes(group) || held[group] !== UNREAD);
}
