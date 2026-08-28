/**
 * Where a repository's configuration lives, and how the shell obtains it.
 *
 * `automations.yml` at the repository ROOT is the decided path (D93 —
 * Q14's path half): the file configures the automation platform, not
 * GitHub, and everywhere else in the design GitHub is an adapter detail —
 * a `.github/` home would contradict that at the most user-visible spot.
 * Credential-free development and CI read an operator-maintained local
 * copy; the live adapter reads the same path from the default branch.
 */

import { readFile } from "node:fs/promises";
import {
    ABSENT_CONFIG_REVISION,
    CONFIG_PATH,
    type ConfigDocument,
    type ConfigLoadOutcome,
    type ConfigSource,
    revisionOf,
} from "@hiero-hackers/automation-core";

export {
    ABSENT_CONFIG_REVISION,
    CONFIG_PATH,
    type ConfigDocument,
    type ConfigLoadOutcome,
    type ConfigSource,
};

/** The credential-free source: an operator-maintained local copy. */
export function fileConfigSource(path: string): ConfigSource {
    return {
        async load(): Promise<ConfigLoadOutcome> {
            let raw: string;
            try {
                raw = await readFile(path, "utf8");
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                    return {
                        ok: false,
                        permanent: false,
                        detail: `local config unreadable: ${(error as Error).message}`,
                    };
                }
                // ENOENT genuinely proves absence locally. An absent file and
                // an empty file agree by construction: both parse to
                // no-config's observe mode (config-schema.md §1, §4).
                return {
                    ok: true,
                    document: { revision: ABSENT_CONFIG_REVISION, text: "" },
                };
            }
            // The live source's UTF-8 decode drops a leading BOM (the WHATWG
            // default); drop it here too, so the same committed bytes yield
            // the same text and revision in every environment (D122).
            const text = raw.replace(/^\uFEFF/, "");
            return { ok: true, document: { revision: revisionOf(text), text } };
        },
    };
}
