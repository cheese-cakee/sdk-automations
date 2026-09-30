/** A kept group's stored value read back (D193): total over whatever the row holds, `null` for another shape. */

import type { AssigneeClock, ItemRef, LinkedIssue } from "../../catalogue.js";
import { ENTITY_KINDS } from "../../config/index.js";

export const recordOf = (value: unknown): Record<string, unknown> | null =>
    typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;

export function instantOf(value: unknown): Date | null {
    if (typeof value !== "string") return null;
    const at = new Date(value);
    return Number.isFinite(at.getTime()) ? at : null;
}

/** An instant the value allows to be absent: `null` there is an answer, not a gap. */
export function optionalInstant(value: unknown): { readonly at: Date | null } | null {
    if (value === null) return { at: null };
    const at = instantOf(value);
    return at === null ? null : { at };
}

export function itemOf(value: unknown): ItemRef | null {
    const ref = recordOf(value);
    const kind = ENTITY_KINDS.find((named) => named === ref?.["kind"]);
    const number = ref?.["number"];
    return kind === undefined || typeof number !== "number" || !Number.isSafeInteger(number)
        ? null
        : { kind, number };
}

/** Every entry read by one reader, or `null` if any entry is not that shape. */
export function each<T>(value: unknown, read: (entry: unknown) => T | null): readonly T[] | null {
    if (!Array.isArray(value)) return null;
    const entries: T[] = [];
    for (const entry of value) {
        const one = read(entry);
        if (one === null) return null;
        entries.push(one);
    }
    return entries;
}

function clockOf(value: unknown): AssigneeClock | null {
    const clock = recordOf(value);
    if (clock === null || typeof clock["login"] !== "string") return null;
    const assignedAt = instantOf(clock["assignedAt"]);
    const worked = optionalInstant(clock["lastWorkingAt"]);
    return assignedAt === null || worked === null
        ? null
        : { login: clock["login"], assignedAt, lastWorkingAt: worked.at };
}

export const clocksOf = (value: unknown): readonly AssigneeClock[] | null => each(value, clockOf);

export function linkedOf(value: unknown): LinkedIssue | null {
    const linked = recordOf(value);
    const item = itemOf(linked?.["item"]);
    const assignees = clocksOf(linked?.["assignees"]);
    return item === null || assignees === null ? null : { item, assignees };
}
