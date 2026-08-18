/**
 * The seam the real GitHub adapter will replace. Until it exists the shell
 * runs on stated sandbox facts, so the test that matters is that every one
 * of them is overridable through the one seam — a stub that cannot be
 * replaced is a fact hard-coded twice.
 */

import { describe, expect, it } from "vitest";
import { stubbedExternals } from "../src/externals.js";

describe("first-slice external facts", () => {
    it("defaults to the documented sandbox facts", () => {
        const externals = stubbedExternals();
        expect(externals.killSwitchActive).toBe(false);
        expect(externals.installationGrants).toEqual(["issues:write"]);
        expect(externals.latestHumanChangeAt({ kind: "issue", number: 1 })).toBeNull();
    });

    it("lets the real adapter replace every stub through one seam", () => {
        const latestHumanChangeAt = () => "unknown" as const;
        const externals = stubbedExternals({
            killSwitchActive: true,
            installationGrants: [],
            latestHumanChangeAt,
        });
        expect(externals).toEqual({
            killSwitchActive: true,
            installationGrants: [],
            latestHumanChangeAt,
        });
    });
});
