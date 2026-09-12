/**
 * The total readers of a journal row's untrusted bytes.
 *
 * Every function here answers over `unknown` and returns a value or `null`;
 * none of them throws. That is what lets `parseJournaledCall` and each
 * handler's `parse` give the only safe answer to a row nobody can read —
 * close it, resend nothing. This process having written the bytes buys
 * nothing: they crossed a durability boundary that outlives the version that
 * wrote them.
 */

import type { ItemRef } from "@hiero-hackers/automation-core";

/** Is this value a plain object a row's fields could be read from? */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

/** One field, own properties only, so no prototype value arrives as a row's. */
export const at = (value: unknown, name: string): unknown =>
    isRecord(value) && Object.hasOwn(value, name) ? value[name] : undefined;

/** One field as a non-empty string, or `null`. */
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
