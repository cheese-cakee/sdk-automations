/**
 * Every trigger the example workflow wakes the Action on must be one the run
 * can use: an event the engine routes (under the name the Action maps it to),
 * the sweep and its manual twin, or a trigger ignored on purpose and said so
 * here. The allowlist is held from the other side too — an event the engine
 * has since started routing must leave it, so it cannot go stale.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { composeSources, repoRoot } from "./repository.js";

/** Triggers the Action receives and deliberately does nothing with. */
const IGNORED: Readonly<Record<string, string>> = {
    pull_request_review: "ignored until the reviews capability ships",
};

/** The engine's routing table: the keys of `NORMALIZERS`. */
function routedEvents(eventsText: string): string[] {
    const table = /NORMALIZERS:[\s\S]*?=\s*\{([\s\S]*?)\};/.exec(eventsText)?.[1] ?? "";
    return [...table.matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1]!);
}

/** The runner events the Action renames onto a webhook, as `runnerEvent === "a" ? "b"`. */
function renamedEvents(sources: readonly string[]): Map<string, string> {
    const pairs = sources.flatMap((text) =>
        [...text.matchAll(/===\s*"([a-z_]+)"\s*\?\s*"([a-z_]+)"/g)].map(
            (m) => [m[1]!, m[2]!] as const,
        ),
    );
    return new Map(pairs);
}

function workflowEvents(workflowText: string): string[] {
    const on = (parse(workflowText) as { on?: unknown }).on;
    if (typeof on === "string") return [on];
    if (Array.isArray(on)) return on.map(String);
    return on !== null && typeof on === "object" ? Object.keys(on) : [];
}

/** The workflow events that are neither usable nor allowlisted. */
function unusable(
    events: readonly string[],
    routed: readonly string[],
    renamed: ReadonlyMap<string, string>,
    ignored: Readonly<Record<string, string>>,
): string[] {
    return events.filter((event) => {
        if (event === "schedule" || event === "workflow_dispatch") return false;
        if (routed.includes(renamed.get(event) ?? event)) return false;
        return !(event in ignored);
    });
}

/** The allowlisted events the engine now routes. */
function staleIgnores(
    routed: readonly string[],
    renamed: ReadonlyMap<string, string>,
    ignored: Readonly<Record<string, string>>,
): string[] {
    return Object.keys(ignored).filter((event) => routed.includes(renamed.get(event) ?? event));
}

describe("the example workflow's triggers", () => {
    const routed = routedEvents(
        readFileSync(join(repoRoot, "packages/core/src/engine/events.ts"), "utf8"),
    );
    const renamed = renamedEvents(composeSources());
    const events = workflowEvents(
        readFileSync(join(repoRoot, "docs/examples/sdk-automations.workflow.yml"), "utf8"),
    );

    it("are routed, renamed onto a routed event, the sweep, or ignored on purpose", () => {
        expect(routed.length).toBeGreaterThan(0);
        expect(events.length).toBeGreaterThan(0);
        expect(unusable(events, routed, renamed, IGNORED)).toEqual([]);
    });

    it("leave no ignored trigger the engine now routes", () => {
        expect(staleIgnores(routed, renamed, IGNORED)).toEqual([]);
    });

    it("proves the check can fail", () => {
        const table =
            "const NORMALIZERS: { readonly [E in P]: N<E> } = {\n    issues: a,\n    pull_request: b,\n};";
        expect(routedEvents(table)).toEqual(["issues", "pull_request"]);
        const rename = renamedEvents(['x === "pull_request_target" ? "pull_request" : x']);
        expect(rename.get("pull_request_target")).toBe("pull_request");

        // An unknown event fails; a renamed one passes only through the rename.
        expect(unusable(["push"], routed, renamed, IGNORED)).toEqual(["push"]);
        expect(unusable(["pull_request_target"], ["pull_request"], new Map(), {})).toEqual([
            "pull_request_target",
        ]);
        // An ignored event the engine started routing is stale.
        expect(staleIgnores(["pull_request_review"], new Map(), IGNORED)).toEqual([
            "pull_request_review",
        ]);
        expect(workflowEvents("on:\n  push:\n  schedule: []\n")).toEqual(["push", "schedule"]);
    });
});
