/**
 * Managed-comment identity (D125, amended by D145): what the platform mints,
 * what it refuses to read back, and the one judgement that decides whether a
 * comment stands under a given identity.
 *
 * The marker's exact bytes are pinned. They are a wire format — comments
 * already posted by an earlier deployment must still be recognised — so a
 * change to the spelling is a schema change, and this is where it stops being
 * an accident.
 */

import { describe, expect, it } from "vitest";
import {
    MANAGED_COMMENT_KINDS,
    MANAGED_COMMENT_MISMATCHES,
    MANAGED_MARKER_PREFIX,
    MANAGED_MARKER_REJECTIONS,
    MANAGED_MARKER_SCHEMA_VERSION,
    MANAGED_MARKER_SUFFIX,
    MANAGED_PAYLOAD_BYTE_LIMIT,
    MANAGED_SUBJECT_DIGEST_LENGTH,
    addressManagedComment,
    deriveManagedMarker,
    managedCommentOf,
    managedMarkerPayload,
    matchesManagedComment,
    parseManagedMarker,
    type ManagedIdentity,
} from "../../src/index.js";

const identity: ManagedIdentity = {
    capability: "prQuality",
    item: { kind: "pullRequest", number: 12 },
    kind: "summary",
    topic: "",
};

/** The identity as the matcher takes it — what a mint publishes. */
const published = managedMarkerPayload(identity);

/** A marker built from parts, so a test can vary one field without retyping the rest. */
const markerOf = (payload: unknown): string =>
    `${MANAGED_MARKER_PREFIX}${JSON.stringify(payload)}${MANAGED_MARKER_SUFFIX}`;

describe("what the platform mints", () => {
    /**
     * The whole marker, byte for byte: prefix, field order, and the digest
     * length. Nothing else in the suite would notice a reordered payload, and a
     * reordered payload is a different string for every comment already posted.
     */
    it("is an HTML comment carrying version, capability, kind and subject digest", () => {
        expect(deriveManagedMarker(identity)).toBe(
            '<!-- hiero-automation:{"schemaVersion":2,"capability":"prQuality","kind":"summary","subject":"e1a382cce4e4f9a6"} -->',
        );
    });

    it("pairs the identity with its marker", () => {
        expect(managedCommentOf(identity)).toEqual({
            identity,
            marker: deriveManagedMarker(identity),
        });
    });

    /**
     * The digest is of the whole subject — capability, item, kind, topic — and
     * of nothing else. Two identities differing in any one of them must not
     * share a marker, or one purpose's comment would be edited under another's
     * name; two identities differing in none of them must share one, which is
     * the whole of D145.
     */
    it.each([
        ["capability", { capability: "intake" }],
        ["item kind", { item: { kind: "issue", number: 12 } as const }],
        ["item number", { item: { kind: "pullRequest", number: 13 } as const }],
        ["kind", { kind: "warning" as const }],
        ["topic", { topic: "alice" }],
    ])("gives an identity differing in its %s a different digest", (_field, differing) => {
        expect(managedMarkerPayload({ ...identity, ...differing }).subject).not.toBe(
            published.subject,
        );
    });

    it("gives the same subject the same digest, at the pinned length", () => {
        expect(managedMarkerPayload({ ...identity }).subject).toBe(published.subject);
        expect(published.subject).toHaveLength(MANAGED_SUBJECT_DIGEST_LENGTH);
    });

    /**
     * A topic is free text, so the digest encodes its boundaries. Without that
     * the topics "a" and "b" on one identity would collide with "a b" and ""
     * on another — silently one comment (D65, D74).
     */
    it("keeps two topics apart that a delimiter join would run together", () => {
        expect(managedMarkerPayload({ ...identity, capability: "a", topic: "b" }).subject).not.toBe(
            managedMarkerPayload({ ...identity, capability: "a b", topic: "" }).subject,
        );
    });

    /** Every kind is its own purpose, and every capability its own comment. */
    it("gives every kind and every capability its own marker", () => {
        const markers = MANAGED_COMMENT_KINDS.map((kind) =>
            deriveManagedMarker({ ...identity, kind }),
        );
        expect(new Set(markers).size).toBe(MANAGED_COMMENT_KINDS.length);
        expect(deriveManagedMarker({ ...identity, capability: "intake" })).not.toBe(
            deriveManagedMarker(identity),
        );
    });

    /**
     * Neither wording nor occasion is identity. A capability that recomputes a
     * slightly different body must address the same comment, the marker must
     * not change under an UPDATE, and a new event about the same item is that
     * comment again rather than a second one (D145).
     */
    it("takes nothing from a comment's wording or its occasion", () => {
        expect(Object.keys(published)).toEqual(["schemaVersion", "capability", "kind", "subject"]);
    });

    it("round-trips everything it mints", () => {
        for (const kind of MANAGED_COMMENT_KINDS) {
            const mine = { ...identity, kind };
            expect(parseManagedMarker(deriveManagedMarker(mine))).toEqual({
                recognized: managedMarkerPayload(mine),
            });
        }
    });

    /** The applier writes the body after the marker; identity survives it. */
    it("round-trips with a rendered body following the marker", () => {
        const body = `${deriveManagedMarker(identity)}\nThis pull request does not reference an issue.`;
        expect(parseManagedMarker(body)).toEqual({ recognized: published });
    });
});

describe("what the parser refuses, and why", () => {
    const rejection = (body: string): string | null => {
        const reading = parseManagedMarker(body);
        return "unrecognized" in reading ? reading.unrecognized : null;
    };

    /** Every documented reason is reachable — a vocabulary with a dead entry is a lie. */
    it("reaches every rejection reason exactly once", () => {
        const reached = [
            rejection("Thanks for opening this."),
            rejection(markerOf({ schemaVersion: 2, capability: "x".repeat(600) })),
            rejection(markerOf({ schemaVersion: 2, capability: "prQuality" })),
            rejection(markerOf({ ...published, schemaVersion: 1, effect: published.subject })),
            rejection(markerOf({ ...published, schemaVersion: 3 })),
        ];
        expect(reached).toEqual([...MANAGED_MARKER_REJECTIONS]);
    });

    it("refuses a body with no marker, and one whose marker never closes", () => {
        expect(rejection("")).toBe("noMarker");
        expect(rejection("Thanks for opening this.")).toBe("noMarker");
        // The marker must be the body's FIRST bytes: quoted inside prose it is
        // not a claim, which is why a leading space is enough to lose it.
        expect(rejection(` ${deriveManagedMarker(identity)}`)).toBe("noMarker");
        expect(rejection(`${MANAGED_MARKER_PREFIX}{"schemaVersion":2}`)).toBe("noMarker");
    });

    /**
     * The cap is on the PAYLOAD, not the comment: a long human comment that
     * happens to open with the prefix is refused for what it says, not its size.
     */
    it("refuses a payload over the byte limit, and accepts one at it", () => {
        const padded = (bytes: number) => {
            const skeleton = JSON.stringify({ ...published, pad: "" });
            return markerOf({ ...published, pad: "x".repeat(bytes - skeleton.length) });
        };
        expect(rejection(padded(MANAGED_PAYLOAD_BYTE_LIMIT))).toBe(null);
        expect(rejection(padded(MANAGED_PAYLOAD_BYTE_LIMIT + 1))).toBe("oversized");
    });

    /** Bytes, not characters: one emoji is four of them. */
    it("counts the limit in UTF-8 bytes", () => {
        const skeleton = JSON.stringify({ ...published, pad: "" });
        const room = MANAGED_PAYLOAD_BYTE_LIMIT - skeleton.length;
        const emoji = "\u{1F600}".repeat(Math.floor(room / 4));
        expect(rejection(markerOf({ ...published, pad: emoji }))).toBe(null);
        expect(rejection(markerOf({ ...published, pad: `${emoji}\u{1F600}` }))).toBe("oversized");
    });

    it("refuses anything that is not a JSON object of the fields v2 declares", () => {
        expect(rejection(`${MANAGED_MARKER_PREFIX}not json${MANAGED_MARKER_SUFFIX}`)).toBe(
            "malformed",
        );
        expect(rejection(markerOf([published]))).toBe("malformed");
        expect(rejection(markerOf("a string"))).toBe("malformed");
        expect(rejection(markerOf(null))).toBe("malformed");
        expect(rejection(markerOf({ ...published, capability: 7 }))).toBe("malformed");
        expect(rejection(markerOf({ ...published, capability: "" }))).toBe("malformed");
        expect(rejection(markerOf({ ...published, kind: "gossip" }))).toBe("malformed");
        expect(rejection(markerOf({ ...published, subject: "not-hex-at-all!" }))).toBe("malformed");
        expect(rejection(markerOf({ ...published, subject: published.subject.slice(1) }))).toBe(
            "malformed",
        );
        expect(rejection(markerOf({ ...published, subject: `${published.subject}0` }))).toBe(
            "malformed",
        );
        expect(
            rejection(markerOf({ ...published, subject: published.subject.toUpperCase() })),
        ).toBe("malformed");
    });

    /**
     * Three wrong versions, three different answers. A v1 marker published a
     * digest of the EFFECT id under a field this reader does not read, so it is
     * refused outright rather than compared against a digest of another thing
     * (D145) — nothing armed ever posted one outside the sandbox. A version
     * above waits for a newer reader. A version below one was never written by
     * anything, so it is a defect and reads as malformed with the rest.
     */
    it("separates a prior version from a future one and from a malformed one", () => {
        expect(
            rejection(markerOf({ ...published, schemaVersion: MANAGED_MARKER_SCHEMA_VERSION })),
        ).toBe(null);
        expect(
            rejection(markerOf({ ...published, schemaVersion: MANAGED_MARKER_SCHEMA_VERSION - 1 })),
        ).toBe("priorVersion");
        expect(
            rejection(markerOf({ ...published, schemaVersion: MANAGED_MARKER_SCHEMA_VERSION + 1 })),
        ).toBe("futureVersion");
        expect(rejection(markerOf({ ...published, schemaVersion: 99 }))).toBe("futureVersion");
        expect(rejection(markerOf({ ...published, schemaVersion: 0 }))).toBe("malformed");
        expect(rejection(markerOf({ ...published, schemaVersion: -1 }))).toBe("malformed");
        expect(rejection(markerOf({ ...published, schemaVersion: 1.5 }))).toBe("malformed");
        expect(rejection(markerOf({ ...published, schemaVersion: "2" }))).toBe("malformed");
        expect(rejection(markerOf({ capability: "prQuality", kind: "summary" }))).toBe("malformed");
    });

    /**
     * A version this reader does not read is refused before its other fields
     * are judged: it has no grounds to call another schema's field malformed,
     * and the answers need different responses.
     */
    it("calls a wrong version wrong even when the rest of it makes no sense", () => {
        expect(rejection(markerOf({ schemaVersion: 3, whatever: true }))).toBe("futureVersion");
        expect(rejection(markerOf({ schemaVersion: 1, whatever: true }))).toBe("priorVersion");
    });
});

describe("does this comment stand under this identity?", () => {
    const marker = deriveManagedMarker(identity);

    it("recognises the App's own comment", () => {
        expect(matchesManagedComment({ body: marker, authoredByApp: true }, published)).toEqual({
            matches: true,
        });
        expect(
            matchesManagedComment(
                { body: `${marker}\nrendered content`, authoredByApp: true },
                published,
            ),
        ).toEqual({ matches: true });
    });

    /**
     * The attack the catalogue names: a repository user copies the App's
     * marker into their own comment. Byte-identical, and never a match — which
     * is why authorship is a parameter of the judgement rather than a check the
     * caller is trusted to have already done.
     */
    it("refuses a byte-identical marker under another author", () => {
        expect(matchesManagedComment({ body: marker, authoredByApp: false }, published)).toEqual({
            matches: false,
            why: "notAppAuthored",
        });
    });

    /** Authorship is answered first: an unauthored body is never even parsed. */
    it("puts authorship ahead of the bytes, whatever the bytes are", () => {
        for (const body of ["", marker, "nothing like a marker", `${marker}extra`]) {
            expect(matchesManagedComment({ body, authoredByApp: false }, published)).toEqual({
                matches: false,
                why: "notAppAuthored",
            });
        }
    });

    /** Every documented mismatch is reachable, and they stay three distinct answers. */
    it("reaches every mismatch reason exactly once", () => {
        const why = (candidate: { body: string; authoredByApp: boolean }): string | null => {
            const verdict = matchesManagedComment(candidate, published);
            return verdict.matches ? null : verdict.why;
        };
        expect([
            why({ body: marker, authoredByApp: false }),
            why({ body: "a human wrote this", authoredByApp: true }),
            why({
                body: deriveManagedMarker({ ...identity, capability: "intake" }),
                authoredByApp: true,
            }),
        ]).toEqual([...MANAGED_COMMENT_MISMATCHES]);
    });

    /** A marker of another schema is an unrecognised one, not another purpose's. */
    it("reads an unreadable marker as no marker at all", () => {
        expect(
            matchesManagedComment(
                { body: markerOf({ schemaVersion: 3 }), authoredByApp: true },
                published,
            ),
        ).toEqual({ matches: false, why: "noManagedMarker" });
    });

    /** Each field of the identity is load-bearing, one at a time. */
    it.each([
        ["capability", { capability: "intake" }],
        ["kind", { kind: "warning" as const }],
        ["topic", { topic: "alice" }],
        ["item", { item: { kind: "issue", number: 12 } as const }],
    ])("does not match the App's own comment for a different %s", (_field, differing) => {
        expect(
            matchesManagedComment(
                { body: deriveManagedMarker({ ...identity, ...differing }), authoredByApp: true },
                published,
            ),
        ).toEqual({ matches: false, why: "otherSubject" });
    });
});

/**
 * The one place a principal NAME becomes a handle. The subject is the
 * substitution and the boundary it protects: a capability says a name, the
 * repository's file says what the name is, and neither the capability nor its
 * intent ever holds the team string.
 */
describe("addressManagedComment", () => {
    const principals = { maintainerTeam: "hiero-ledger/solo-maintainers" };

    it("leaves a comment that names nobody exactly as it was", () => {
        expect(addressManagedComment("plain body", undefined, principals)).toBe("plain body");
    });

    it("resolves a declared principal to its handle, ahead of the body", () => {
        expect(addressManagedComment("this issue is on fire.", "maintainerTeam", principals)).toBe(
            "@hiero-ledger/solo-maintainers — this issue is on fire.",
        );
    });

    /**
     * Never silently dropped: a comment that cc'd nobody and said nothing about
     * it is the failure `principal()` exists to prevent, so the name survives
     * as text without becoming a mention.
     */
    it("renders an undeclared principal as its name, pinging nobody", () => {
        expect(addressManagedComment("body.", "releaseTeam", principals)).toBe(
            "`releaseTeam` — body.",
        );
    });

    it("resolves against the file's own record, never a guess", () => {
        expect(addressManagedComment("body.", "maintainerTeam", {})).toBe(
            "`maintainerTeam` — body.",
        );
    });
});
