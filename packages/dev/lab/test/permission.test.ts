import { describe, expect, it } from "vitest";
import { permissionAccepted } from "../src/probes/compare.js";

describe("a recorded permission against GitHub's accepted-permissions header", () => {
    it("accepts a grant the header offers, in either spelling", () => {
        expect(permissionAccepted("issues:read", "issues=read; pull_requests=read")).toBe(true);
        expect(permissionAccepted("pull_requests:read", "pull_requests=read")).toBe(true);
    });
    it("accepts either alternative of a recorded choice", () => {
        expect(permissionAccepted("issues:read|pull_requests:read", "pull_requests=read")).toBe(
            true,
        );
    });
    it("refuses a grant the header does not offer", () => {
        expect(permissionAccepted("contents:read", "issues=read; pull_requests=read")).toBe(false);
        expect(permissionAccepted("issues:read+pull_requests:read", "issues=read")).toBe(false);
    });
});
