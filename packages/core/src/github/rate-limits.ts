/**
 * Parsing and automatic-wait bounds for GitHub rate-limit headers (experiment 6.4, D40).
 * GitHub documents these fields as whole seconds: a malformed one must not become no wait.
 */

export type ParsedSecondsHeader =
    | { readonly kind: "missing" }
    | { readonly kind: "invalid"; readonly rawValue: string }
    | { readonly kind: "valid"; readonly seconds: number };

/** Longer waits belong in durable scheduling or operator handling, not the automatic retry path. */
export const MAX_AUTOMATIC_RATE_LIMIT_WAIT_SECONDS = 60 * 60;

export function parseSecondsHeader(rawValue: string | undefined): ParsedSecondsHeader {
    if (rawValue === undefined) return { kind: "missing" };
    if (!/^\d+$/.test(rawValue)) {
        return { kind: "invalid", rawValue };
    }

    const seconds = Number(rawValue);
    return Number.isSafeInteger(seconds)
        ? { kind: "valid", seconds }
        : { kind: "invalid", rawValue };
}
