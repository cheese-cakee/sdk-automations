/**
 * Nothing carries compatibility history until the platform has launched: one
 * schema version, one migration entry, no versioned constants (D165). Once the
 * launch marker exists it names the floor and migrations are append-only from
 * it. One invariant per file (D89).
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./repository.js";

// Assembled, never written: this file is in the citation checks' own corpus,
// and the marker is deliberately absent until the first real installation.

const LAUNCHED = ["design", "LAUNCHED.md"].join("/");

const SCHEMA = "packages/runtime/src/store/schema.ts";

/** What the schema file declares, read as text so no check imports the runtime. */
interface Declared {
    readonly current: number | null;
    readonly migrations: readonly number[];
    readonly history: readonly string[];
}

function declaredIn(source: string): Declared {
    const current = /CURRENT_STORAGE_SCHEMA_VERSION = (\d+)/.exec(source);
    const entries = /const MIGRATIONS[^[]*\[([\s\S]*?)\];/.exec(source);
    return {
        current: current === null ? null : Number(current[1]),
        migrations: [...(entries?.[1] ?? "").matchAll(/version: (\d+)/g)].map((m) => Number(m[1])),
        history: [...source.matchAll(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_V\d+\b/g)].map((m) => m[0]),
    };
}

/** The schema version the marker names, or `null` when it names none. */
function launchedVersion(marker: string): number | null {
    const named = /schema version (\d+)/i.exec(marker);
    return named === null ? null : Number(named[1]);
}

/** Every version a migration must exist for, from the launched floor to current. */
function versionsFrom(floor: number, current: number): number[] {
    return Array.from({ length: current - floor + 1 }, (_, step) => floor + step);
}

/** How the declared schema disagrees with the launch state; empty means it agrees. */
function violations(declared: Declared, marker: string | null): string[] {
    if (marker === null) {
        return [
            declared.current === 1 ? null : `version ${String(declared.current)}, not 1`,
            declared.migrations.length === 1
                ? null
                : `${String(declared.migrations.length)} migration entries, not 1`,
            declared.history.length === 0
                ? null
                : `history constants ${declared.history.join(" ")}`,
        ].filter((found): found is string => found !== null);
    }
    const floor = launchedVersion(marker);
    if (floor === null) return [`${LAUNCHED} names no schema version`];
    if (declared.current === null || floor > declared.current) {
        return [`${LAUNCHED} names version ${String(floor)}, newer than the code's`];
    }
    const expected = versionsFrom(floor, declared.current);
    return declared.migrations.join(",") === expected.join(",")
        ? []
        : [`migrations ${declared.migrations.join(",")} are not ${expected.join(",")}`];
}

describe("the store carries no compatibility history before launch", () => {
    const declared = declaredIn(readFileSync(join(repoRoot, SCHEMA), "utf8"));
    const marker = existsSync(join(repoRoot, LAUNCHED))
        ? readFileSync(join(repoRoot, LAUNCHED), "utf8")
        : null;

    it("reads the schema the store declares", () => {
        expect(declared.current).not.toBeNull();
        expect(declared.migrations.length).toBeGreaterThan(0);
    });

    it("holds the tree to the state its launch marker declares", () => {
        expect(violations(declared, marker)).toEqual([]);
    });

    it("proves the check can fail in both states", () => {
        const unlaunched = { current: 7, migrations: [1, 2], history: ["SEEN_DELIVERY_V1"] };
        expect(violations(unlaunched, null)).toHaveLength(3);
        expect(violations({ current: 1, migrations: [1], history: [] }, null)).toEqual([]);

        const launched = "Launched on a day, at schema version 2.";
        expect(violations({ current: 3, migrations: [1, 2, 3], history: [] }, launched)).toEqual([
            "migrations 1,2,3 are not 2,3",
        ]);
        expect(violations({ current: 3, migrations: [2, 3], history: [] }, launched)).toEqual([]);
        expect(violations({ current: 1, migrations: [1], history: [] }, launched)).toHaveLength(1);
        expect(violations({ current: 1, migrations: [1], history: [] }, "no version here")).toEqual(
            [`${LAUNCHED} names no schema version`],
        );
    });
});
