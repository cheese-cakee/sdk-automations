/** The total readers of a recorded call's untrusted bytes; none of them throws. */

import type { ItemRef } from "@hiero-hackers/automation-core";

/** Is this value a plain object a row's fields could be read from? */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

/** One field, own properties only, so no prototype value arrives as a row's. */
export const at = (value: unknown, name: string): unknown =>
    isRecord(value) && Object.hasOwn(value, name) ? value[name] : undefined;

export const text = (value: unknown, name: string): string | null => {
    const read = at(value, name);
    return typeof read === "string" && read.length > 0 ? read : null;
};

/** The item a row names, or `null` when it names none this platform could act on. */
export function itemOf(value: unknown): ItemRef | null {
    const kind = at(value, "kind");
    const number = at(value, "number");
    if (kind !== "issue" && kind !== "pullRequest") return null;
    if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 1) return null;
    return { kind, number };
}
