import { describe, it, expect } from "vitest";
import { parseConfig, NO_CONFIG } from "../src/config.js";

describe("parseConfig (design/config/schema.md)", () => {
    it("no configuration yields the safe default — observe mode, nothing enabled (§2.2)", () => {
        for (const raw of [undefined, null]) {
            const result = parseConfig(raw, { knownCapabilities: [] });
            expect(result).toEqual({ ok: true, config: NO_CONFIG });
        }
        // Assert NO_CONFIG's literal shape, not just against itself —
        // a mutation of the constant must fail HERE, not vanish into
        // both sides of the equality above.
        expect(NO_CONFIG.mode).toBe("observe");
        expect(Object.keys(NO_CONFIG.capabilities)).toHaveLength(0);
        expect(Object.keys(NO_CONFIG.principals)).toHaveLength(0);
        expect(NO_CONFIG.mappings).toEqual({ labels: {} });
        expect(NO_CONFIG.schemaVersion).toBe(1);
    });

    it("accepts the documented candidate shape (§3)", () => {
        const result = parseConfig(
            {
                schemaVersion: 1,
                mode: "observe",
                capabilities: {
                    prQuality: {
                        enabled: true,
                        settings: { checks: { dco: true, mergeConflict: true } },
                    },
                    assignment: { enabled: false, settings: { maxOpenAssignments: 2 } },
                },
                mappings: {
                    labels: {
                        ready: "status: ready for dev",
                        inProgress: "status: in progress",
                    },
                },
                principals: { maintainerTeam: "hiero-sdk-cpp-maintainers" },
            },
            { knownCapabilities: ["prQuality", "assignment"] },
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.config.capabilities.prQuality?.enabled).toBe(true);
            expect(result.config.capabilities.assignment?.enabled).toBe(false);
            expect(result.config.mappings.labels.ready).toBe("status: ready for dev");
        }
    });

    it("rejects unknown top-level keys (§2.7 — misspellings must not silently change behavior)", () => {
        const result = parseConfig({ schemaVersion: 1, mode: "observe", capabilties: {} }, { knownCapabilities: [] });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.errors.join()).toContain('unknown key "capabilties"');
    });

    it("rejects unknown capability keys and unknown mapping meanings", () => {
        const result = parseConfig({
            schemaVersion: 1,
            capabilities: { intake: { enable: true } },
            mappings: { labels: { readyForDev: "status: ready" } },
        }, { knownCapabilities: [] });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.errors.join()).toContain('unknown key "enable"');
            expect(result.errors.join()).toContain('"readyForDev" is not a mappable meaning');
        }
    });

    it("fails closed: one error yields no config at all (§2.6)", () => {
        const result = parseConfig({
            schemaVersion: 1,
            mode: "actively", // invalid
            capabilities: { prQuality: { enabled: true } }, // valid
        }, { knownCapabilities: [] });
        expect(result.ok).toBe(false);
        // The message lists the legal modes, readably separated.
        if (!result.ok) expect(result.errors.join()).toContain("disabled, observe, dry-run, active");
        // No partially-applied config object exists on the failure arm.
        expect("config" in result).toBe(false);
    });

    it("rejects unknown keys under mappings", () => {
        const result = parseConfig({
            schemaVersion: 1,
            mappings: { fields: {} },
        }, { knownCapabilities: [] });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.errors.join()).toContain('mappings: unknown key "fields"');
    });

    it("only boolean true enables a capability — truthiness is not consent (§2.4)", () => {
        for (const enabled of [1, "true", "yes"]) {
            const result = parseConfig({
                schemaVersion: 1,
                capabilities: { intake: { enabled } },
            }, { knownCapabilities: [] });
            expect(result.ok).toBe(false);
        }
        const omitted = parseConfig({
            schemaVersion: 1,
            capabilities: { intake: { settings: {} } },
        }, { knownCapabilities: [] });
        expect(omitted.ok).toBe(true);
        if (omitted.ok) expect(omitted.config.capabilities.intake?.enabled).toBe(false);
    });

    it("rejects a wrong or missing schemaVersion", () => {
        expect(parseConfig({ mode: "observe" }, { knownCapabilities: [] }).ok).toBe(false);
        expect(parseConfig({ schemaVersion: 2 }, { knownCapabilities: [] }).ok).toBe(false);
    });

    it("rejects empty label mappings", () => {
        const result = parseConfig({
            schemaVersion: 1,
            mappings: { labels: { ready: "  " } },
        }, { knownCapabilities: [] });
        expect(result.ok).toBe(false);
    });

    // FINDING(config-label-injectivity)
    it("rejects two meanings mapped to one label — label→meaning must be unambiguous (§3)", () => {
        const result = parseConfig({
            schemaVersion: 1,
            mappings: {
                labels: {
                    ready: "status: wip",
                    inProgress: "status: wip",
                },
            },
        }, { knownCapabilities: [] });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.errors.join()).toContain('"status: wip"');
            expect(result.errors.join()).toContain("injective");
        }
    });

    it("injectivity applies across entities too — the strict reading, pending D34", () => {
        const result = parseConfig({
            schemaVersion: 1,
            mappings: {
                labels: {
                    ready: "attention",
                    needsReview: "attention",
                },
            },
        }, { knownCapabilities: [] });
        expect(result.ok).toBe(false);
    });
});

describe("capability registry (FINDING(config-capability-registry-gap), experiment 6.3)", () => {
    const registry = ["prQuality", "assignment"];

    it("rejects an enabled capability outside the registry, naming it and the registry", () => {
        const result = parseConfig(
            { schemaVersion: 1, capabilities: { checksGate: { enabled: true } } },
            { knownCapabilities: registry },
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.errors.join()).toContain('"checksGate"');
            expect(result.errors.join()).toContain("capability registry");
            // The registry listing is sorted so maintainers can scan it.
            expect(result.errors.join()).toContain("assignment, prQuality");
        }
    });

    it("an empty registry says so — 'none' rather than a blank list", () => {
        const result = parseConfig(
            { schemaVersion: 1, capabilities: { prQuality: { enabled: true } } },
            { knownCapabilities: [] },
        );
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.errors.join()).toContain("known: none");
    });

    it("keeps a disabled unknown capability dormant — removing a shipped capability must not break configs that still mention it", () => {
        const result = parseConfig(
            { schemaVersion: 1, capabilities: { retired: { enabled: false, settings: { old: 1 } } } },
            { knownCapabilities: registry },
        );
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.config.capabilities.retired?.enabled).toBe(false);
    });

    /**
     * An EMPTY registry rejects every enabled capability — the authority
     * boundary. Note what is no longer expressible: `knownCapabilities`
     * is required, so a caller cannot reach this outcome by forgetting an
     * argument. Omission is a compile error; `[]` is a stated choice.
     */
    it("an empty registry fails closed instead of bypassing the authority boundary", () => {
        const result = parseConfig({
            schemaVersion: 1,
            capabilities: { checksGate: { enabled: true } },
        }, { knownCapabilities: [] });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.errors.join()).toContain("(known: none)");
    });

    it("a registry rejection fails closed like every other error (§2.6)", () => {
        const result = parseConfig(
            {
                schemaVersion: 1,
                capabilities: {
                    prQuality: { enabled: true }, // valid
                    checksGate: { enabled: true }, // not shipped
                },
            },
            { knownCapabilities: registry },
        );
        expect(result.ok).toBe(false);
        expect("config" in result).toBe(false);
    });
});
