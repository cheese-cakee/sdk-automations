/**
 * Where the repository's configuration file lives, and how its revision is
 * derived from the exact bytes — content addressing, so two loads of the
 * same text agree and an edit is always a new revision.
 */

import { describe, expect, it } from "vitest";
import { withTempDir } from "@hiero-hackers/automation-testkit";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_PATH, fileConfigSource } from "../src/config.js";

describe("configuration source", () => {
    it("owns the repository path and content-addresses exact text", async () => {
        expect(CONFIG_PATH).toBe("automations.yml");
        // Returned, not fired and forgotten: withTempDir chains the removal
        // onto the promise, so the directory outlives the load it feeds.
        await withTempDir("shell-config-", async (directory) => {
            const path = join(directory, CONFIG_PATH);
            writeFileSync(path, "mode: observe\n");

            await expect(fileConfigSource(path).load()).resolves.toEqual({
                revision: "sha256:d7c5e99c8a84",
                text: "mode: observe\n",
            });
        });
    });

    it("maps only an absent file to the no-config document", async () => {
        await withTempDir("shell-config-", async (directory) => {
            await expect(fileConfigSource(join(directory, "missing.yml")).load()).resolves.toEqual({
                revision: "sha256:absent",
                text: "",
            });
        });
        await expect(fileConfigSource("\0").load()).rejects.toThrow();
    });
});
