/**
 * The App's own comment: how one is marked, and how the platform recognises one
 * it wrote. Identity is platform-owned, and per ITEM and PURPOSE, never per
 * occasion (D125, D145).
 */

import { createHash } from "node:crypto";
import { MANAGED_COMMENT_KINDS, type ItemRef, type ManagedCommentKind } from "../catalogue.js";

// ─── Shape and bounds ────────────────────────────────────────────────

/** The marker's opening bytes; a future version must match it to be refused, not missed. */
export const MANAGED_MARKER_PREFIX = "<!-- hiero-automation:";

/** The marker's closing bytes — the payload is everything between the two. */
export const MANAGED_MARKER_SUFFIX = " -->";

/** The only payload schema that is read; v1 published an effect digest and is refused (D145). */
export const MANAGED_MARKER_SCHEMA_VERSION = 2;

/** Bounds: the UTF-8 bytes `JSON.parse` is handed, and the subject digest's hex length. */
export const MANAGED_PAYLOAD_BYTE_LIMIT = 512;
export const MANAGED_SUBJECT_DIGEST_LENGTH = 16;

/**
 * What a managed comment IS: one capability's one purpose on one item. `topic`
 * is the capability's own discriminator, `""` where there is nothing to tell apart.
 */
export interface ManagedIdentity {
    readonly capability: string;
    readonly item: ItemRef;
    readonly kind: ManagedCommentKind;
    readonly topic: string;
}

/**
 * The identity as published — the JSON object inside the marker. `subject` is
 * the digest of the whole identity, topic included; nothing reads a topic back.
 */
export interface ManagedMarkerPayload {
    readonly schemaVersion: typeof MANAGED_MARKER_SCHEMA_VERSION;
    readonly capability: string;
    readonly kind: ManagedCommentKind;
    readonly subject: string;
}

/** An identity together with the marker that publishes it. */
export interface ManagedComment {
    readonly identity: ManagedIdentity;
    readonly marker: string;
}

// ─── Minting ─────────────────────────────────────────────────────────

/** The identity, digested: JSON rather than a join, so no free-text topic collides (D65, D74). */
const subjectDigest = (identity: ManagedIdentity): string =>
    createHash("sha256")
        .update(
            JSON.stringify([
                identity.capability,
                identity.item.kind,
                String(identity.item.number),
                identity.kind,
                identity.topic,
            ]),
            "utf8",
        )
        .digest("hex")
        .slice(0, MANAGED_SUBJECT_DIGEST_LENGTH);

/** The payload one identity publishes — the comparison both sides of a match use. */
export function managedMarkerPayload(identity: ManagedIdentity): ManagedMarkerPayload {
    return {
        schemaVersion: MANAGED_MARKER_SCHEMA_VERSION,
        capability: identity.capability,
        kind: identity.kind,
        subject: subjectDigest(identity),
    };
}

/** The marker for one identity; fields written out so its bytes never depend on build order. */
export function deriveManagedMarker(identity: ManagedIdentity): string {
    const payload = managedMarkerPayload(identity);
    const encoded = JSON.stringify({
        schemaVersion: payload.schemaVersion,
        capability: payload.capability,
        kind: payload.kind,
        subject: payload.subject,
    });
    return `${MANAGED_MARKER_PREFIX}${encoded}${MANAGED_MARKER_SUFFIX}`;
}

/** Both halves at once — what an approved effect carries downstream. */
export function managedCommentOf(identity: ManagedIdentity): ManagedComment {
    return { identity, marker: deriveManagedMarker(identity) };
}

// ─── Reading untrusted bytes ─────────────────────────────────────────

/** Why a comment body carries no readable identity (`design/contracts/catalogue.md`). */
export const MANAGED_MARKER_REJECTIONS = [
    "noMarker",
    "oversized",
    "malformed",
    "priorVersion",
    "futureVersion",
] as const;

export type ManagedMarkerRejection = (typeof MANAGED_MARKER_REJECTIONS)[number];

/** What a comment body turned out to be. */
export type ManagedMarkerReading =
    | { readonly recognized: ManagedMarkerPayload }
    | { readonly unrecognized: ManagedMarkerRejection };

const DIGEST_PATTERN = /^[0-9a-f]+$/;

/** A JSON object, or `null` for anything else — arrays and scalars included. */
function jsonObject(text: string): Record<string, unknown> | null {
    try {
        const value: unknown = JSON.parse(text);
        return typeof value === "object" && value !== null && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : null;
    } catch {
        return null;
    }
}

const UTF8 = new TextEncoder();

const isManagedCommentKind = (value: unknown): value is ManagedCommentKind =>
    (MANAGED_COMMENT_KINDS as readonly unknown[]).includes(value);

/**
 * The identity a comment body publishes, or why it publishes none. The marker
 * must be the body's FIRST bytes; each wrong version gets its own answer (D145).
 */
export function parseManagedMarker(body: string): ManagedMarkerReading {
    if (!body.startsWith(MANAGED_MARKER_PREFIX)) return { unrecognized: "noMarker" };
    const end = body.indexOf(MANAGED_MARKER_SUFFIX);
    if (end < 0) return { unrecognized: "noMarker" };

    const encoded = body.slice(MANAGED_MARKER_PREFIX.length, end);
    if (UTF8.encode(encoded).length > MANAGED_PAYLOAD_BYTE_LIMIT) {
        return { unrecognized: "oversized" };
    }

    const fields = jsonObject(encoded);
    if (fields === null) return { unrecognized: "malformed" };

    // 1 is the FIRST schema that ever existed: below it is a defect, not a deployment.
    const version = fields["schemaVersion"];
    if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
        return { unrecognized: "malformed" };
    }
    if (version < MANAGED_MARKER_SCHEMA_VERSION) return { unrecognized: "priorVersion" };
    if (version > MANAGED_MARKER_SCHEMA_VERSION) return { unrecognized: "futureVersion" };

    const capability = fields["capability"];
    const kind = fields["kind"];
    const subject = fields["subject"];
    if (typeof capability !== "string" || capability === "") return { unrecognized: "malformed" };
    if (!isManagedCommentKind(kind)) return { unrecognized: "malformed" };
    if (
        typeof subject !== "string" ||
        subject.length !== MANAGED_SUBJECT_DIGEST_LENGTH ||
        !DIGEST_PATTERN.test(subject)
    ) {
        return { unrecognized: "malformed" };
    }

    return {
        recognized: {
            schemaVersion: MANAGED_MARKER_SCHEMA_VERSION,
            capability,
            kind,
            subject,
        },
    };
}

// ─── The judgement ───────────────────────────────────────────────────

/** Why a comment does not stand under this identity. */
export const MANAGED_COMMENT_MISMATCHES = [
    "notAppAuthored",
    "noManagedMarker",
    "otherSubject",
] as const;

export type ManagedCommentMismatch = (typeof MANAGED_COMMENT_MISMATCHES)[number];

/** A comment offered for recognition: its bytes and their author, never separable. */
export interface ManagedCommentCandidate {
    readonly body: string;
    readonly authoredByApp: boolean;
}

/** Whether the candidate stands under the given identity, or why it does not. */
export type ManagedCommentMatch =
    { readonly matches: true } | { readonly matches: false; readonly why: ManagedCommentMismatch };

/**
 * Does this comment stand under this identity? Authorship is answered first,
 * before the bytes are read at all: a copied marker is never a match (D125).
 */
export function matchesManagedComment(
    candidate: ManagedCommentCandidate,
    mine: ManagedMarkerPayload,
): ManagedCommentMatch {
    if (!candidate.authoredByApp) return { matches: false, why: "notAppAuthored" };

    const reading = parseManagedMarker(candidate.body);
    if (!("recognized" in reading)) return { matches: false, why: "noManagedMarker" };

    const found = reading.recognized;
    return found.capability === mine.capability &&
        found.kind === mine.kind &&
        found.subject === mine.subject
        ? { matches: true }
        : { matches: false, why: "otherSubject" };
}

// ─── Addressing a comment ────────────────────────────────────────────

/**
 * The one place a principal NAME becomes a `@`-handle; a name the file does not
 * declare renders in backticks and pings nobody.
 */
export function addressManagedComment(
    body: string,
    mention: string | undefined,
    principals: Readonly<Record<string, string>>,
): string {
    if (mention === undefined) return body;
    const handle = principals[mention];
    return handle === undefined ? `\`${mention}\` — ${body}` : `@${handle} — ${body}`;
}
