/** Where the shell keeps its own files when the environment names none: one path on every platform. */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Everything under the state home belongs to this deployment, not to Node. */
const DIRECTORY_NAME = "sdk-automations";

/** The superseded default, inside the package; only the startup warning cares. */
export const LEGACY_DATA_DIR = fileURLToPath(new URL("../../data/", import.meta.url));

/** A relative `XDG_STATE_HOME` is ignored rather than resolved: the spec calls it invalid. */
export function defaultDataDir(
    env: Readonly<Partial<Record<string, string>>> = process.env,
    home: string = homedir(),
): string {
    const stateHome = env["XDG_STATE_HOME"];
    // `isAbsolute("")` is false, so the empty name needs no clause of its own.

    const base =
        stateHome !== undefined && isAbsolute(stateHome)
            ? stateHome
            : join(home, ".local", "state");
    return join(base, DIRECTORY_NAME);
}

/**
 * The store at the superseded default that this run will not open, or `null`.
 * Said once at startup and never acted on: moving a claimed store is the operator's call.
 */
export function strandedStore(
    {
        env,
        storePath,
    }: {
        readonly env: Readonly<Partial<Record<string, string>>>;
        readonly storePath: string;
    },
    exists: (path: string) => boolean = existsSync,
): string | null {
    if (env["STORE_PATH"] !== undefined) return null;
    const superseded = join(LEGACY_DATA_DIR, "shell.sqlite");
    return exists(superseded) && !exists(storePath) ? superseded : null;
}
