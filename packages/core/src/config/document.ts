/**
 * Text on disk to a `ConfigResult`. The only file here that reads YAML, so
 * the `yaml` dependency stays quarantined behind it (D82).
 *
 * Still pure: text in, result out. The shell reads the bytes.
 */

import { parseDocument, type YAMLError } from "yaml";
import { parseConfig } from "./parse.js";
import { err, type ConfigError, type ConfigResult } from "./results.js";
import type { ParseConfigOptions } from "./schema.js";

/**
 * Aliases can expand quadratically — the "billion laughs" shape — and this
 * file arrives in a pull request from anyone. The library allows 100. A
 * repository configuration has no legitimate use for aliases at all, so the
 * bound is set where no honest document reaches.
 */
const MAX_ALIAS_COUNT = 10;

/**
 * A YAML-level problem, classified.
 *
 * The library's message is used verbatim: it already carries the position and
 * a source excerpt, so restating either would be one fact twice (D77).
 * `path` stays null, because a path is a route into a mapping and a file that
 * never became one has none.
 *
 * `duplicateKey` is separated because it is the only syntax error that
 * SUCCEEDS. YAML keeps the last value, so `mode: observe` followed later by
 * `mode: active` parses cleanly into a repository that writes. Every other
 * syntax error yields no document at all, which is loud.
 */
function documentError(error: YAMLError): ConfigError {
    return error.code === "DUPLICATE_KEY"
        ? err(
              "duplicateKey",
              `${error.message}\nYAML keeps the LAST value, so the earlier one is silently discarded.`,
              null,
          )
        : err("documentUnparseable", error.message, null);
}

/**
 * Parse a configuration file.
 *
 * Syntax errors are reported together, matching what `parseConfig` does for
 * semantic ones. A document that will not parse is never handed onward:
 * guessing at a half-read file is how a fail-closed parser fails open.
 */
export function parseConfigDocument(
    text: string,
    options: ParseConfigOptions,
): ConfigResult {
    const document = parseDocument(text);

    if (document.errors.length > 0) {
        return { ok: false, errors: document.errors.map(documentError) };
    }

    /**
     * `toJS` throws when the alias budget is exceeded rather than reporting
     * it. Nothing else in this layer throws, so it is converted here and
     * `parseConfigDocument` keeps the property that every rejection is a
     * value.
     */
    let value: unknown;
    try {
        value = document.toJS({ maxAliasCount: MAX_ALIAS_COUNT });
    } catch (_cause) {
        return {
            ok: false,
            errors: [
                err(
                    "documentUnparseable",
                    `the document expands to more than ${MAX_ALIAS_COUNT} YAML aliases and was not read; a repository configuration has no legitimate use for anchors at that scale`,
                    null,
                ),
            ],
        };
    }

    /**
     * An empty file is not an error. `parseConfig` already answers `null`
     * with `NO_CONFIG`, so an empty file and an absent file agree by
     * construction rather than by two paths that happen to match.
     */
    return parseConfig(value, options);
}
