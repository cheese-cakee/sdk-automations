/**
 * The scrubber — protocol 7.1's rules as code.
 *
 * D87's named risk was captures leaking sandbox identifiers into tracked
 * fixtures, and its rule was that the scrubbing exists BEFORE the first
 * capture. This is that. `capture.ts` runs every payload through here before
 * anything touches disk, so an unscrubbed body is unrepresentable rather
 * than forbidden.
 *
 * The strategy is deterministic REPLACEMENT, not deletion: the normalizer's
 * fixtures must keep their referential structure — the same account appearing
 * as sender and assignee must still be the same account after scrubbing, and
 * a URL must still contain the login its payload names. So identifiers map to
 * stable placeholders within one payload, and every string value is rewritten
 * with the same mapping.
 */

/** Keys whose STRING value names an account, org, or repository. */
const IDENTIFYING_KEYS = new Set(["login", "slug", "name", "full_name"]);

/** Keys whose NUMERIC value is a GitHub database id. */
const ID_KEYS = new Set(["id", "database_id", "installation_id", "hook_id"]);

const EMAIL = /[^\s"@]+@[^\s"@]+\.[^\s"@]+/g;

/**
 * Full-length git object ids tie a fixture to sandbox history — not personal,
 * but exactly the linkage 7.1 removes. Replaced deterministically so
 * head/base/merge fields that repeat a sha keep repeating it.
 */
const GIT_SHA = /^[0-9a-f]{40}$/;

/** Deterministic 40-hex placeholder: same input sha, same output sha. */
function shaFor(sha: string, mapping: Mapping): string {
    const existing = mapping.strings.get(sha);
    if (existing !== undefined) return existing;
    const stamped = String(mapping.strings.size + 1).padStart(40, "0");
    mapping.strings.set(sha, stamped);
    return stamped;
}

interface Mapping {
    readonly strings: Map<string, string>;
    readonly numbers: Map<number, number>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Pass one: collect every identifying value, mapping each to a stable
 * placeholder in order of first appearance. `name` and `full_name` are only
 * identifying only when the object that directly contains the field carries
 * a `login`, `slug`, or `full_name` — a label's `name` is content, an owner's
 * `name` is identity. That scope does not flow into nested domain content.
 */
function collect(value: unknown, mapping: Mapping): void {
    if (Array.isArray(value)) {
        for (const item of value) collect(item, mapping);
        return;
    }
    if (!isRecord(value)) return;

    const identityObject =
        typeof value["login"] === "string" ||
        typeof value["slug"] === "string" ||
        typeof value["full_name"] === "string";

    for (const [key, child] of Object.entries(value)) {
        if (typeof child === "string" && IDENTIFYING_KEYS.has(key)) {
            if (!identityObject && (key === "name" || key === "full_name")) continue;
            for (const part of child.split("/")) {
                if (part !== "" && !mapping.strings.has(part)) {
                    mapping.strings.set(part, `scrubbed-${mapping.strings.size + 1}`);
                }
            }
            continue;
        }
        if (typeof child === "number" && ID_KEYS.has(key)) {
            if (!mapping.numbers.has(child)) {
                mapping.numbers.set(child, mapping.numbers.size + 1);
            }
            continue;
        }
        collect(child, mapping);
    }
}

/** Longest-first, so `octo-org-repo` is not half-replaced via `octo-org`. */
function rewrite(text: string, mapping: Mapping): string {
    let out = text.replace(EMAIL, "scrubbed@example.invalid");
    for (const original of [...mapping.strings.keys()].sort((a, b) => b.length - a.length)) {
        out = out.split(original).join(mapping.strings.get(original)!);
    }
    return out;
}

function transform(value: unknown, mapping: Mapping): unknown {
    if (Array.isArray(value)) return value.map((item) => transform(item, mapping));
    if (isRecord(value)) {
        const out: Record<string, unknown> = {};
        for (const [key, child] of Object.entries(value)) {
            if (key === "node_id" && typeof child === "string") {
                out[key] = "SCRUBBED_NODE_ID";
            } else if (key === "description" && typeof child === "string") {
                // Free-prose metadata (repo/org/label descriptions): never
                // identifier-shaped, so the identifier passes miss it, and
                // never content the normalizer reads. Blanked wholesale.
                out[key] = child === "" ? "" : "scrubbed-description";
            } else if (typeof child === "string" && GIT_SHA.test(child)) {
                out[key] = shaFor(child, mapping);
            } else if (typeof child === "number" && ID_KEYS.has(key)) {
                out[key] = mapping.numbers.get(child) ?? child;
            } else {
                out[key] = transform(child, mapping);
            }
        }
        return out;
    }
    if (typeof value === "string") return rewrite(value, mapping);
    return value;
}

/**
 * Scrub one webhook payload. Deterministic: the same payload always produces
 * the same output, and within a payload the same identifier always produces
 * the same placeholder — which is what keeps a fixture structurally faithful
 * to the delivery it came from.
 */
export function scrubPayload(payload: unknown): unknown {
    const mapping: Mapping = { strings: new Map(), numbers: new Map() };
    collect(payload, mapping);
    return transform(payload, mapping);
}
