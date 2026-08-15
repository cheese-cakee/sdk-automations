/**
 * Where a repository's configuration lives, and how the shell obtains it.
 *
 * `.github/hiero-automations.yml` is the repository contract. Stage 3 reads
 * an operator-maintained local copy; Stage 5 replaces `fileConfigSource`
 * with a default-branch GitHub fetch behind this same seam.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

/** The path inside the configured repository, relative to its root. */
export const CONFIG_PATH = ".github/hiero-automations.yml";

export interface ConfigDocument {
    /** Names WHICH text was decided on; lands in every persisted record. */
    readonly revision: string;
    readonly text: string;
}

export interface ConfigSource {
    load(): Promise<ConfigDocument>;
}

/** Content-addressed, so a changed file is always a changed revision. */
function revisionOf(text: string): string {
    return `sha256:${createHash("sha256").update(text).digest("hex").slice(0, 12)}`;
}

export function fileConfigSource(path: string): ConfigSource {
    return {
        async load(): Promise<ConfigDocument> {
            let text: string;
            try {
                text = await readFile(path, "utf8");
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
                // An absent file and an empty file agree by construction:
                // both parse to no-config's observe mode (schema.md §2.2).
                return { revision: "sha256:absent", text: "" };
            }
            return { revision: revisionOf(text), text };
        },
    };
}
