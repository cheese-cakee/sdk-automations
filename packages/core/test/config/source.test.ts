import { describe, expect, it } from "vitest";
import { ABSENT_CONFIG_REVISION, CONFIG_PATH } from "../../src/config/index.js";

describe("configuration source identity", () => {
    it("shares one path and one absent revision", () => {
        expect(CONFIG_PATH).toBe("automations.yml");
        expect(ABSENT_CONFIG_REVISION).toBe("sha256:absent");
    });
});
