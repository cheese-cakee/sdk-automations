/** What every store statement checks its arguments for before it runs. */

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

export function assertNonEmpty(value: string, param: string): void {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new TypeError(`${param} must be a non-empty string`);
    }
}
