/**
 * What GitHub's payload readably says, and nothing about what it means.
 *
 * These are the total readers of untrusted bytes: each takes `unknown` or a
 * bare record, answers a value or `null`, and never throws. Distrust is
 * bought once, here. The family modules downstream spend it — they read
 * `DeliveryFacts` without checking it again.
 *
 * The verdicts these readings become live in `verdict.ts`; the walk that
 * calls them in order, and the failure code each `null` earns, in
 * `../events.ts`.
 */

import type { Actor, Alerts, RepositoryRef } from "../../capability/index.js";
import type { MappableMeaning, RepositoryConfig } from "../../config/index.js";

export function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The label NAMES on an item, or null if the shape is not GitHub's. */
export function labelNames(item: Record<string, unknown>): readonly string[] | null {
    const labels = item["labels"];
    if (!Array.isArray(labels)) return null;
    const names: string[] = [];
    for (const label of labels) {
        if (!isRecord(label) || typeof label["name"] !== "string") return null;
        names.push(label["name"]);
    }
    return names;
}

/**
 * Who opened the item, or `null` when the payload does not readably say.
 *
 * Read in the preamble because EVERY family carries it in the same place, and
 * because it is not a fact group: an item nobody opened does not exist, so
 * there is no honest `unread` for it and a payload without one is malformed.
 */
export function authorLogin(item: Record<string, unknown>): string | null {
    const user = item["user"];
    if (!isRecord(user)) return null;
    const login = user["login"];
    return typeof login === "string" && login.length > 0 ? login : null;
}

/**
 * Who GitHub says caused this delivery, or `null` when the payload names
 * nobody readably.
 *
 * `null` rather than a refusal: every consumed event carries a `sender`, but a
 * delivery whose sender is unreadable is still a readable delivery about an
 * item, and refusing the whole record would lose the projection over a field
 * only one capability reads. What a `null` costs is stated where it is read —
 * a capability that cannot tell who acted must treat the record as one nobody
 * caused.
 */
export function senderOf(payload: Record<string, unknown>): Actor | null {
    const sender = payload["sender"];
    if (!isRecord(sender) || typeof sender["login"] !== "string") return null;
    return { login: sender["login"] };
}

/**
 * The label this delivery ADDED, or `null` when it added none.
 *
 * Only an `action: "labeled"` payload names one. Every other delivery — an
 * edit, an assignment, a close — answers `null`, and so does a `labeled`
 * payload whose `label.name` is unreadable: a label we cannot name is one we
 * cannot say arrived.
 */
export function labelAdded(payload: Record<string, unknown>): string | null {
    if (payload["action"] !== "labeled") return null;
    const label = payload["label"];
    if (!isRecord(label) || typeof label["name"] !== "string") return null;
    return label["name"];
}

/** A valid Date from an ISO field, or null. */
export function timestamp(value: unknown): Date | null {
    if (typeof value !== "string") return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
}

export function repositoryOf(
    payload: Record<string, unknown>,
): { readonly owner: string; readonly repo: string } | null {
    const repository = payload["repository"];
    if (!isRecord(repository)) return null;
    const owner = repository["owner"];
    if (!isRecord(owner) || typeof owner["login"] !== "string") return null;
    if (typeof repository["name"] !== "string") return null;
    return { owner: owner["login"], repo: repository["name"] };
}

/**
 * The repository a payload readably names — total over `unknown`, `null`
 * when it names none. Exported for the shell's serving-boundary check, so
 * the one reading of these three fields lives beside the normalizer that
 * owns them; a payload this cannot read is one `normalizeDelivery` reports
 * as `payloadNotObject` or `repositoryUnreadable`, and a caller must not
 * pre-empt that with a refusal of its own.
 */
export function repositoryNamedBy(
    payload: unknown,
): { readonly owner: string; readonly repo: string } | null {
    return isRecord(payload) ? repositoryOf(payload) : null;
}

/**
 * Everything the shared preamble read, handed to the family that finishes.
 *
 * `item` is still the raw record, because only a family knows which of its
 * remaining fields carry meaning — `merged` on a pull request, `state` on an
 * issue. Every other field here has been read already and is trusted.
 */
export interface DeliveryFacts {
    readonly repository: RepositoryRef;
    readonly item: Record<string, unknown>;
    readonly number: number;
    readonly author: string;
    readonly meanings: readonly MappableMeaning[];
    /** What this item carries, and what this delivery added — through `mappings.alerts`. */
    readonly alerts: Alerts;
    /** The delivery's sender, or `null` — see `senderOf`. */
    readonly actor: Actor | null;
    readonly observedAt: Date;
    /**
     * The delivery body, already proved to be a record — for the SIBLING keys
     * of the item, which is where an event family's own subject may sit. Only
     * `issue_comment` reads it today (its command is on `comment`, not on
     * `issue`); a family whose whole subject is the item never touches it.
     */
    readonly payload: Record<string, unknown>;
    /**
     * The repository's reviewed configuration, for the reverse readings a
     * family needs beyond labels. `meanings` and `alerts` above are the label
     * readings the preamble already spent it on; a family needing another
     * family's reading — `commandInComment` — asks for it here rather than
     * being handed a third pre-computed list nobody else uses.
     */
    readonly config: RepositoryConfig;
}
