import { describe, expect, it } from "vitest";
import { asDeliveryGuid, signBody, verifyBody } from "../src/index.js";
describe("webhook primitives", () => {
    it("validates delivery GUIDs", () => {
        expect(asDeliveryGuid("72d3162e-cc78-11e3-81ab-4c9367dc0958")).toBeDefined();
        expect(asDeliveryGuid("bad")).toBeUndefined();
    });
    it("verifies exact signed bytes", () => {
        const body = Buffer.from([0, 1, 255]);
        const signature = signBody("secret", body);
        expect(verifyBody("secret", body, signature)).toBe(true);
        expect(verifyBody("secret", Buffer.from([0, 1]), signature)).toBe(false);
    });
});
