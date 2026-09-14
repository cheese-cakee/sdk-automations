/**
 * The capability runtime boundary, tested from inside its own package.
 *
 * The capabilities package's suites test the boundary in COMPOSITION — a real
 * capability, the planner, the store. This file tests it in ISOLATION, which
 * is what had to survive that scaffold being deleted.
 */

import { describe, expect, it } from "vitest";
import { declareCapability, flag, projectCapabilityView, spec, text } from "../../src/index.js";
import { configWith } from "../config/builders.js";

const declaration = declareCapability({
    name: "fixture",
    triggers: [{ kind: "event", event: "issues" }],
    settings: spec({ announce: flag({ default: false }) }),
    requiredMappings: {},
    facts: ["issue"],
    needs: [],
    resolvers: ["linkedIssues"],
    intents: ["applyMappedLabel", "unassign"],
});

describe("projectCapabilityView (contract.md §2)", () => {
    const config = configWith({
        capabilities: ["fixture", "other"],
        settings: { fixture: { announce: true }, other: { secret: "theirs" } },
        specs: {
            fixture: spec({ announce: flag({ default: false }) }),
            other: spec({ secret: text({ optional: true }) }),
        },
        labels: { awaitingTriage: "status: triage", blocked: "blocked" },
    });

    it("carries the capability's own settings, as the parser resolved them", () => {
        const view = projectCapabilityView(declaration, config);
        expect(view.settings).toEqual({ announce: true });
    });

    it("never exposes another capability's configuration", () => {
        expect(JSON.stringify(projectCapabilityView(declaration, config))).not.toContain("theirs");
    });

    /** D71 — availability of a meaning, never the repository's word for it. */
    it("reports mapped meanings without exposing a label string", () => {
        const view = projectCapabilityView(declaration, config);
        expect([...view.mapped.labels].sort()).toEqual(["awaitingTriage", "blocked"]);
        expect(JSON.stringify(view)).not.toContain("status: triage");
    });

    it("reports no mapped meanings when the repository mapped none", () => {
        const bare = configWith({ mode: "observe", known: ["fixture"] });
        const view = projectCapabilityView(declaration, bare);
        expect(view.mapped).toEqual({
            labels: [],
            commands: [],
            skills: [],
            alerts: [],
        });
    });

    /**
     * A block the file never mentioned. `decide()` evaluates nothing whose
     * block is absent, so this is the answer `NO_CONFIG` and any other
     * hand-built configuration gets — and it is the capability's own defaults,
     * because an empty object would promise a field it does not hold.
     */
    it("resolves the declaration's own defaults for a block the file never named", () => {
        const unmentioned = configWith({ mode: "observe", known: ["fixture"] });
        expect(projectCapabilityView(declaration, unmentioned).settings).toEqual({
            announce: false,
        });
    });

    /**
     * The one spec that has no defaults to fall back on: a required field
     * cannot be absent, so there is nothing honest to resolve and the empty
     * block is what the view carries.
     */
    it("carries the empty block when the spec cannot be read against nothing", () => {
        const demanding = declareCapability({
            ...declaration,
            name: "demanding",
            settings: spec({ guide: text({ optional: false }) }),
        });
        const unmentioned = configWith({ mode: "observe", known: ["demanding"] });
        expect(projectCapabilityView(demanding, unmentioned).settings).toEqual({});
    });
});
