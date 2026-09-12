/** The one timestamp the store accepts, and the ordering property that rests on it. */

/** Exactly `Date.toISOString()`: constant width makes lexicographic order chronological. */
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
