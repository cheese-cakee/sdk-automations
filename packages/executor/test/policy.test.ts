import { describe, expect, it } from "vitest";
import {
    LEASE_MS,
    READBACK_ABSENT_READS,
    READBACK_CONFIRM_ABSENT_DELAY_MS,
    REQUEUE_STALE_MS,
    RETENTION_DAYS,
} from "../src/policy.js";

describe("adopted operational policy", () => {
    it("keeps lease, requeue, retention, and read-back facts explicit", () => {
        expect(LEASE_MS).toBe(15 * 60_000);
        expect(REQUEUE_STALE_MS).toBe(30 * 60_000);
        expect(REQUEUE_STALE_MS).toBe(2 * LEASE_MS);
        expect(RETENTION_DAYS).toBe(90);
        expect(READBACK_ABSENT_READS).toBe(2);
        expect(READBACK_CONFIRM_ABSENT_DELAY_MS).toBe(1_000);
    });
});
