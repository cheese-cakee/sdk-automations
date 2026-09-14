/**
 * Where the store lands when nobody says. The rule this file locks is that
 * the default is somewhere the OPERATOR owns: a container that redeploys
 * replaces its image layers, and the canonical reports would go with them.
 */

import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { defaultDataDir } from "../../src/shell/paths.js";

const HOME = "/home/operator";

describe("the default data directory", () => {
    it("is the state home the environment names", () => {
        expect(defaultDataDir({ XDG_STATE_HOME: "/var/lib/state" }, HOME)).toBe(
            join("/var/lib/state", "sdk-automations"),
        );
    });

    it("falls back to ~/.local/state when the environment names none", () => {
        expect(defaultDataDir({}, HOME)).toBe(join(HOME, ".local", "state", "sdk-automations"));
    });

    /**
     * The spec calls a relative XDG path invalid, and resolving one would
     * put the store somewhere different for every way of starting the
     * process — a `cd` would silently become a new, empty database.
     */
    it.each(["", "relative/state", "./state"])("ignores %j as a state home", (stateHome) => {
        expect(defaultDataDir({ XDG_STATE_HOME: stateHome }, HOME)).toBe(
            join(HOME, ".local", "state", "sdk-automations"),
        );
    });

    it("never lands inside the package, which is where a container's image ends", () => {
        expect(defaultDataDir({}, HOME)).not.toContain(join("packages", "runtime"));
    });
});
