/**
 * Text on disk to a `ConfigResult`, and to WHERE in that text each rejection
 * sits. The only file here that reads YAML, so the `yaml` dependency stays
 * quarantined behind it (D82). Still pure: text in, result out.
 */

import {
    LineCounter,
    isMap,
    isNode,
    isScalar,
    isSeq,
    parseDocument,
    type Node,
    type ParsedNode,
    type YAMLError,
} from "yaml";
import { parseConfig } from "./parse.js";
import { err, type ConfigError, type ConfigResult } from "./results.js";
import type { ParseConfigOptions } from "./schema.js";

/** Aliases can expand quadratically; no honest configuration uses one. */
const MAX_ALIAS_COUNT = 10;

/** A value that contains itself through an alias: `toJS` returns it, `JSON.stringify` never will. */
function refersToItself(value: unknown, ancestors: Set<object>): boolean {
    if (typeof value !== "object" || value === null) return false;
    if (ancestors.has(value)) return true;
    ancestors.add(value);
    const children = Array.isArray(value) ? value : Object.values(value);
    const found = children.some((child) => refersToItself(child, ancestors));
    ancestors.delete(value);
    return found;
}

/** Classified. `duplicateKey` is the only syntax error that SUCCEEDS. */
function documentError(error: YAMLError): ConfigError {
    return error.code === "DUPLICATE_KEY"
        ? err(
              "duplicateKey",
              `${error.message}\nYAML keeps the LAST value, so the earlier one is silently discarded.`,
              null,
          )
        : err("documentUnparseable", error.message, null);
}

/** A path segment that indexes a sequence rather than naming a key. */
const SEQUENCE_INDEX = /^\d+$/;

/** One segment resolved: the node whose line it is, and the node beneath it. */
interface Reached {
    readonly at: Node;
    readonly under: unknown;
}

/** One segment, looked up in the node before it. For a mapping, the entry's KEY. */
function childOf(node: unknown, segment: string): Reached | null {
    if (isMap(node)) {
        for (const pair of node.items) {
            if (isScalar(pair.key) && String(pair.key.value) === segment) {
                return { at: pair.key, under: pair.value };
            }
        }
        return null;
    }
    if (isSeq(node) && SEQUENCE_INDEX.test(segment)) {
        const item: unknown = node.items[Number(segment)];
        return isNode(item) ? { at: item, under: item } : null;
    }
    return null;
}

/**
 * The node a dotted path names, or the nearest ancestor the document does
 * contain; `null` when it contains no part of the path. A dotted key is unreachable.
 */
function nodeAtPath(contents: ParsedNode | null, path: string): Node | null {
    let node: unknown = contents;
    let deepest: Node | null = null;

    for (const segment of path.split(".")) {
        const reached = childOf(node, segment);
        if (reached === null) break;
        deepest = reached.at;
        node = reached.under;
    }
    return deepest;
}

/** Where a node's text begins, as a 1-based line. */
function lineOf(node: Node | null, lines: LineCounter): number | undefined {
    const range = node === null ? null : node.range;
    return range ? lines.linePos(range[0]).line : undefined;
}

/** The line a dotted path resolves to, or `undefined`. Exported for its own tests. */
export function lineOfPath(text: string, path: string): number | undefined {
    const lines = new LineCounter();
    const document = parseDocument(text, { lineCounter: lines });
    return lineOf(nodeAtPath(document.contents, path), lines);
}

/** The same error, carrying the line its path resolves to when it resolves to one. */
function withLine(
    error: ConfigError,
    contents: ParsedNode | null,
    lines: LineCounter,
): ConfigError {
    if (error.path === null) return error;
    const line = lineOf(nodeAtPath(contents, error.path), lines);
    return line === undefined ? error : { ...error, line };
}

/** Parse a configuration file. A document that will not parse is never handed onward. */
export function parseConfigDocument(text: string, options: ParseConfigOptions): ConfigResult {
    const lines = new LineCounter();
    const document = parseDocument(text, { lineCounter: lines });

    if (document.errors.length > 0) {
        return { ok: false, errors: document.errors.map(documentError) };
    }

    /**
     * `toJS` throws when the alias budget is exceeded rather than reporting
     * it; converted here, so every rejection stays a returned value.
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

    if (refersToItself(value, new Set())) {
        return {
            ok: false,
            errors: [
                err(
                    "documentUnparseable",
                    "the document refers to itself through a YAML alias and was not read",
                    null,
                ),
            ],
        };
    }

    /** An empty file is not an error: `parseConfig` answers `null` with `NO_CONFIG`. */
    const result = parseConfig(value, options);
    if (result.ok) return result;

    return {
        ok: false,
        errors: result.errors.map((error) => withLine(error, document.contents, lines)),
    };
}
