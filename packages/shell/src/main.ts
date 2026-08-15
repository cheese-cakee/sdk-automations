/**
 * The sandbox-era entry point: environment in, listening shell out.
 *
 * Environment supplies the authenticated endpoint and repository identity.
 * data/ (never tracked) is the default home for the store and config copy.
 *
 * Run:
 *   WEBHOOK_SECRET=… REPO_OWNER=… REPO_NAME=… pnpm --filter @hiero-hackers/automation-shell start
 */

import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Store } from "@hiero-hackers/automation-store";
import { createShell } from "./shell.js";
import { CONFIG_PATH, fileConfigSource } from "./config.js";

const env = process.env;
const secret = env["WEBHOOK_SECRET"];
const owner = env["REPO_OWNER"];
const repo = env["REPO_NAME"];
if (!secret || !owner || !repo) {
    console.error(
        "WEBHOOK_SECRET, REPO_OWNER and REPO_NAME are required (the sandbox App's secret and the repository this endpoint serves).",
    );
    process.exit(1);
}

const dataDir = fileURLToPath(new URL("../data/", import.meta.url));
mkdirSync(dataDir, { recursive: true });
const configFile = env["CONFIG_FILE"] ?? `${dataDir}hiero-automations.yml`;
const storeFile = env["STORE_PATH"] ?? `${dataDir}shell.sqlite`;
const port = Number(env["PORT"] ?? 8790);

const shell = createShell({
    secret,
    store: new Store(storeFile),
    // An operator-maintained copy of the repository's CONFIG_PATH file;
    // the read-only adapter later fetches the live one behind this seam.
    configSource: fileConfigSource(configFile),
    linkedIssueReader: {
        read: async () => ({
            outcome: "unknown",
            reason: "GitHub linked-issue reads are unavailable until Stage 5",
        }),
    },
    repository: { owner, repo },
});

// Start recovering anything a previous run left pending before listening.
void shell.drain().catch((error) => {
    console.error("shell: startup drain failed; inspect durable store state", error);
});
shell.server.listen(port, () => {
    console.log(
        `shell listening on :${port} for ${owner}/${repo} (config copy of ${CONFIG_PATH}: ${configFile}); canonical reports stored in ${storeFile}`,
    );
});
