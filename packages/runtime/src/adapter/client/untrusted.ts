/** Reading bytes GitHub sent, without trusting them; every reader is total, never a throw. */

/** A property read that cannot throw; own properties only. */
export function field(value: unknown, name: string): unknown {
    if (typeof value !== "object" || value === null) return undefined;
    try {
        return Object.hasOwn(value, name) ? (value as Record<string, unknown>)[name] : undefined;
    } catch {
        return undefined;
    }
}

/** The body as a JSON object, or `null` when it is anything else. */
export function jsonRecordOf(body: string): Record<string, unknown> | null {
    let parsed: unknown;
    // Stryker disable BlockStatement: an emptied catch leaves parsed undefined, and the shape checks answer null anyway.
    try {
        parsed = JSON.parse(body);
    } catch {
        return null;
    }
    // Stryker restore BlockStatement
    // Stryker disable next-line ConditionalExpression: when parsed IS null the mutant returns parsed — the same null. The arm is for readers.
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
}

/** The body as a JSON array, or `null` when it is anything else. */
export function jsonArrayOf(body: string): readonly unknown[] | null {
    let parsed: unknown;
    // Stryker disable BlockStatement: an emptied catch leaves parsed undefined, and the shape checks answer null anyway.
    try {
        parsed = JSON.parse(body);
    } catch {
        return null;
    }
    // Stryker restore BlockStatement
    return Array.isArray(parsed) ? parsed : null;
}
