import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG_PATH, fileConfigSource } from "../src/config.js";
import { stubbedExternals } from "../src/externals.js";

const directories: string[] = [];

afterEach(() => {
    for (const directory of directories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

describe("configuration source", () => {
    it("owns the repository path and content-addresses exact text", async () => {
        expect(CONFIG_PATH).toBe("automations.yml");
        const directory = mkdtempSync(join(tmpdir(), "shell-config-"));
        directories.push(directory);
        const path = join(directory, CONFIG_PATH);
        writeFileSync(path, "mode: observe\n");

        await expect(fileConfigSource(path).load()).resolves.toEqual({
            revision: "sha256:d7c5e99c8a84",
            text: "mode: observe\n",
        });
    });

    it("maps only an absent file to the no-config document", async () => {
        const directory = mkdtempSync(join(tmpdir(), "shell-config-"));
        directories.push(directory);
        await expect(fileConfigSource(join(directory, "missing.yml")).load()).resolves.toEqual({
            revision: "sha256:absent",
            text: "",
        });
        await expect(fileConfigSource("\0").load()).rejects.toThrow();
    });
});

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
