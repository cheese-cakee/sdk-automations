/**
 * The one timestamp the store accepts, and the ordering property that
 * rests on it.
 *
 * Every `<=` in `store.ts`'s SQL is a SQLite string comparison over
 * timestamps validated here, which is why this file imports nothing: the
 * transitions depend on it and it depends on none of them.
 */

/**
 * The ONE timestamp format the store accepts: exactly the
 * `Date.toISOString()` shape — millisecond precision, `Z` suffix.
 *
 * Constant width is what makes lexicographic order chronological order,
 * and every `<=` comparison in `store.ts` relies on that. Mixed precision
 * breaks it: `"…00Z" > "…00.500Z"` as strings, but earlier in time,
 * because `'Z'` sorts above `'.'`. An offset format sorts wrongly
 * outright. Both are caller bugs, so both throw rather than misorder.
 *
 * Exported so the shell can validate before a store call.
 */
export function assertUtcInstant(value: string, param: string): void {
    const epochMs = Date.parse(value);
    if (
        value.length !== 24 ||
        !Number.isFinite(epochMs) ||
        new Date(epochMs).toISOString() !== value
    ) {
        throw new TypeError(
            `${param} must be a millisecond-precision UTC instant, exactly Date.toISOString() form (got ${JSON.stringify(value)})`,
        );
    }
}
