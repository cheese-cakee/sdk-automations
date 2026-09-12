/**
 * The App's own comment: how one is marked, and how the platform recognises
 * one it wrote (D125, amended by D145).
 *
 * Identity is PLATFORM-OWNED. A capability supplies a `kind`, an optional
 * `topic` and body content; everything that answers "which comment does this
 * belong to" is derived here from facts the capability cannot forge.
 * `catalogue.ts` owns the kind vocabulary and the item shape, and nothing else
 * here is imported by it, so this file sits one step below the rest of the
 * directory.
 *
 * Identity is per ITEM and per PURPOSE, never per occasion (D145). A comment
 * is a standing thing on an item — one dashboard, updated in place — and the
 * event that provoked this pass is not part of what it is. The occasion still
 * has a name, and it is the journal's: the effect id, which is the intent's
 * idempotency key.
 *
 * Three total functions, in the order a write uses them: `managedCommentOf`
 * mints the marker for an identity, `parseManagedMarker` reads untrusted bytes
 * back, and `matchesManagedComment` judges whether one comment stands under a
 * given identity. Nothing throws.
 */

import { createHash } from "node:crypto";
import { MANAGED_COMMENT_KINDS, type ItemRef, type ManagedCommentKind } from "./catalogue.js";

// ─── Shape and bounds ────────────────────────────────────────────────

/**
 * The marker's opening bytes. The schema version lives in the PAYLOAD rather
 * than here on purpose: a v3 marker must still match the prefix so the parser
 * can refuse it as a future version, instead of missing it and treating a
 * newer deployment's comment as absent.
 */
export const MANAGED_MARKER_PREFIX = "<!-- hiero-automation:";

/** The marker's closing bytes — the payload is everything between the two. */
export const MANAGED_MARKER_SUFFIX = " -->";

/**
 * The only payload schema that is read. v1 published a digest of the EFFECT
 * id, which made identity per occasion; v2 publishes the subject digest
 * instead, and the two cannot be told apart by shape. Nothing armed has ever
 * posted a v1 marker outside the sandbox, so v1 is refused as unrecognized
 * rather than translated (D145).
 */
export const MANAGED_MARKER_SCHEMA_VERSION = 2;

/**
 * Bounds, and why each is what it is.
 *
 * `MANAGED_PAYLOAD_BYTE_LIMIT` caps the UTF-8 bytes handed to `JSON.parse`. A
 * GitHub comment body runs to 65536 characters, and recognition is a test run
 * over every comment on an item — parsing a hostile 64 KiB payload per comment
 * is work a cheap test should not do. A v2 payload is around 110 bytes, so 512
 * is four times the room a second field would need.
 *
 * `MANAGED_SUBJECT_DIGEST_LENGTH` is the hex prefix of the subject's SHA-256.
 * The comparison space is the handful of App-authored comments on ONE item, so
 * 64 bits is already far past what distinguishing them needs; collisions are
 * not a security boundary here, because authorship is.
 */
export const MANAGED_PAYLOAD_BYTE_LIMIT = 512;
export const MANAGED_SUBJECT_DIGEST_LENGTH = 16;

/**
 * What a managed comment IS: one capability's one purpose on one item.
 *
 * `topic` is the capability's own discriminator, and the only field it
 * chooses. It is `""` for the ordinary case — one purpose can stand once on an
 * item, so there is nothing to tell apart — and a short stable word where one
 * purpose can legitimately stand more than once: an assignee's login on a
 * per-person warning, an alert's name on a subscription ping. Two comments
 * differ only if their topics do.
 *
 * The occasion is deliberately absent, and so is the body. A capability that
 * recomputes slightly different wording for the same purpose must not thereby
 * address a different comment, and identity must survive an UPDATE, which
 * changes the body by definition. The occasion is absent for the same reason
 * one step up: a new event about the same item is the same comment, rewritten
 * (D145).
 *
 * The repository is absent because a comment's location already fixes it: the
 * only comments ever compared are the ones on this item.
 */
export interface ManagedIdentity {
    readonly capability: string;
    readonly item: ItemRef;
    readonly kind: ManagedCommentKind;
    readonly topic: string;
}

/**
 * The identity as published — the JSON object inside the marker.
 *
 * Every field earns its place. `schemaVersion` is what lets this reader refuse
 * a v1 or a v3 comment rather than misread it (`design/contracts/catalogue.md`).
 * `capability` and `kind` are in the clear because they are what make a marker
 * legible to a maintainer reading the raw markdown, and they are what make
 * "one short marker per purpose per item" decidable at a glance: two
 * capabilities may both hold a comment on one item, and one capability may
 * hold two purposes.
 *
 * `subject` is the digest of the whole identity — capability, item and kind
 * again, plus the topic. The digest, not the fields: a topic is a capability's
 * free text, and the catalogue keeps free text out of what the platform
 * renders into a comment. Nothing needs to read a topic back; a reader compares digests.
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

/**
 * The identity, digested.
 *
 * JSON, not a delimiter join, for `deriveIdempotencyKey`'s reason (D65, D74):
 * a topic is free text, so no separator is guaranteed absent, and a join
 * collides "a b"+"c" with "a"+"b c" — silently one comment.
 */
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

/**
 * The marker for one identity: an HTML comment, invisible where GitHub renders
 * it.
 *
 * The object literal is written out field by field rather than stringifying the
 * payload record, because `JSON.stringify` preserves insertion order and the
 * marker's bytes must not depend on how the record was built.
 */
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

/** One of `MANAGED_MARKER_REJECTIONS`. */
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
 * The identity a comment body publishes, or why it publishes none.
 *
 * The marker must be the body's FIRST bytes. The platform composes the body, so
 * its own comments always begin with one; requiring the position means a marker
 * quoted inside prose is not even a claim, and recognition costs a prefix test.
 *
 * Version is checked before the other fields, and each wrong version gets its
 * own answer, because the three need different responses. A v1 payload names
 * an EFFECT where this reader expects a subject: its remaining fields would
 * parse and mean something else, so it is refused as `priorVersion` rather
 * than silently compared against a digest of another thing (D145). A future
 * version is a deployment this reader is behind. A version below the first is
 * a defect, and reads as `malformed` with the rest.
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

    // The literal 1 is the FIRST schema that ever existed, not the current one:
    // below it is a version nothing ever wrote, which is a defect rather than a
    // deployment this reader is on either side of.
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

/** One of `MANAGED_COMMENT_MISMATCHES`. */
export type ManagedCommentMismatch = (typeof MANAGED_COMMENT_MISMATCHES)[number];

/**
 * A comment offered for recognition: its bytes, and who wrote them.
 *
 * The two travel together so that no caller can hold a body without also
 * holding the authorship fact. That is the whole reason this is a record rather
 * than a `string` parameter — a marker is worthless as evidence on its own, and
 * a signature that accepted one alone would make the copied-marker attack a
 * matter of remembering to check (`design/contracts/catalogue.md`).
 */
export interface ManagedCommentCandidate {
    readonly body: string;
    readonly authoredByApp: boolean;
}

/** Whether the candidate stands under the given identity, or why it does not. */
export type ManagedCommentMatch =
    { readonly matches: true } | { readonly matches: false; readonly why: ManagedCommentMismatch };

/**
 * Does this comment stand under this identity?
 *
 * The identity is taken AS PUBLISHED rather than as a `ManagedIdentity`,
 * because the caller that asks holds only the published form. The applier asks
 * about the body it is on its way to posting, whether the plan just rendered it
 * or a journal row carried it across a restart, and reads the payload back out
 * of that body's own marker — the row carries the rendered body, never the
 * identity. A subject digest cannot be reversed, so a caller holding an
 * identity publishes it with `managedMarkerPayload` and the two meet here.
 *
 * Authorship is answered first, before the bytes are read at all: a marker
 * copied into a repository user's comment must never reach the parser, let
 * alone a comparison (D125). A byte-identical marker under any other author is
 * `notAppAuthored`, never a match.
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
 * The body a managed comment is posted with, once the principal it names has
 * been resolved to the handle behind it.
 *
 * This is the one place a principal NAME becomes a `@`-handle, and it is the
 * platform's job for the same reason the marker is: a capability that could
 * write the handle could ping any team in the file, and one that could read it
 * would be reading a spelling the boundary spends four paragraphs withholding.
 * The capability says `mention: "maintainerTeam"`; the repository's
 * `principals:` block says what that is; this joins them.
 *
 * It runs BEFORE the effect is minted, so the addressed body is what the
 * verdict judges, what a dry-run reports as `wouldApply`, and what the journal
 * row carries — dry-run says exactly what active would do. Identity is
 * untouched: `topic` is the discriminator (D145), and re-addressing one
 * purpose to a different principal updates the standing comment rather than
 * minting a second.
 *
 * A name the file does not declare renders as the name in backticks and pings
 * nobody. It is not silently dropped, because a comment that cc'd nobody and
 * said nothing about it is the failure mode `principal()` exists to prevent;
 * and for any capability whose settings went through `principal()` the branch
 * is unreachable, since an undeclared name is a settings problem first.
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
