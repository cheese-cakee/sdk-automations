/**
 * Where a repository's configuration lives, and how the shell obtains it.
 *
 * `automations.yml` at the repository ROOT is the decided path (D93 —
 * Q14's path half): the file configures the automation platform, not
 * GitHub, and everywhere else in the design GitHub is an adapter detail —
 * a `.github/` home would contradict that at the most user-visible spot.
 * The first slice reads an operator-maintained LOCAL COPY of that file;
 * the read-only adapter later replaces `fileConfigSource` with a fetch of
 * the same path at the repository's default branch, behind this same seam.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

/** The path inside the configured repository, relative to its root. */
export const CONFIG_PATH = "automations.yml";

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
                // both parse to no-config's observe mode (config-schema.md §1, §4).
                return { revision: "sha256:absent", text: "" };
            }
            return { revision: revisionOf(text), text };
        },
    };
}
