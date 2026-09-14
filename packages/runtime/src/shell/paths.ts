/** Where the shell keeps its own files when the environment names none: one path on every platform. */

import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

/** Everything under the state home belongs to this deployment, not to Node. */
const DIRECTORY_NAME = "sdk-automations";

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

/** The store file `main.ts` opens, by the same rule, for a command that only reads it. */
export function storeFile(env: Readonly<Partial<Record<string, string>>> = process.env): string {
    return env["STORE_PATH"] ?? join(defaultDataDir(env), "shell.sqlite");
}
