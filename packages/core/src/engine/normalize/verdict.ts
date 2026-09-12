/**
 * The verdict vocabulary every normalizer speaks. A delivery becomes a fact
 * record, or it is skipped, or it is refused — and this file owns all three
 * words plus the constructor for the refusal.
 *
 * It reads nothing and decides nothing: `payload.ts` holds the readers,
 * `issues.ts` and `pull-request.ts` the families, `../events.ts` the walk
 * that routes between them. Nothing here imports any of them.
 */

import type { Facts } from "../../capability/index.js";

/**
 * `ignored` and `malformed` are different verdicts on purpose: the first is
 * the system working (most webhook traffic is not workflow traffic), the
 * second is a fact the operator surface must see — it means GitHub's shape
 * and our reading of it have diverged.
 */
export const NORMALIZE_MALFORMED_CODES = [
    "payloadNotObject",
    "repositoryUnreadable",
    "itemMissing",
    "numberMissing",
    "labelsUnreadable",
    "timestampUnreadable",
    "authorUnreadable",
    "mergedMissing",
    "draftMissing",
    "commentUnreadable",
] as const;
/** One way a consumed delivery can be unreadable. */
export type NormalizeMalformedCode = (typeof NORMALIZE_MALFORMED_CODES)[number];

/** The three verdicts on a delivery: read it, skip it, or refuse it. */
export type NormalizeResult =
    | { readonly kind: "facts"; readonly facts: Facts }
    | { readonly kind: "ignored"; readonly event: string }
    | {
          readonly kind: "malformed";
          /** Machine-readable, like every refusal in core (D75). */
          readonly code: NormalizeMalformedCode;
          readonly detail: string;
      };

/** Refuse a delivery. Exported: the family modules refuse in this vocabulary. */
export const malformed = (code: NormalizeMalformedCode, detail: string): NormalizeResult => ({
    kind: "malformed",
    code,
    detail,
});
