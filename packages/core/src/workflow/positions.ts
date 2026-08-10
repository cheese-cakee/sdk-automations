/**
 * Where an item sits, per flow. Everything here is DERIVED from `config`'s
 * `MEANING_FACTS` table and nothing restates it — which is why adding a
 * meaning is a change to config, not to this file.
 */

import {
    MAPPABLE_MEANINGS,
    MEANING_FACTS,
    type EntityKind,
    type MappableMeaning,
} from "../config/index.js";

export type { EntityKind };

/**
 * Read the conditional as "keep K when its declared flow is F, else discard
 * it" — dense, but you never need to read it to USE the types below, and
 * tests pin the results (D90).
 */
type MeaningsWithFlow<F extends EntityKind> = {
    [K in MappableMeaning]: (typeof MEANING_FACTS)[K]["flow"] extends F ? K : never;
}[MappableMeaning];

/** Issue-flow meanings — taxonomy.md §4. `blocked` excluded by construction. */
export type IssueMeaning = MeaningsWithFlow<"issue">;

/** Pull-request-flow meanings — taxonomy.md §5. */
export type PrMeaning = MeaningsWithFlow<"pullRequest">;

/** The one honest narrowing per flow — these replace every cast (D90). */
export function isIssueMeaning(m: MappableMeaning): m is IssueMeaning {
    return MEANING_FACTS[m].flow === "issue";
}
export function isPrMeaning(m: MappableMeaning): m is PrMeaning {
    return MEANING_FACTS[m].flow === "pullRequest";
}

/** The same sets as runtime arrays, in `MAPPABLE_MEANINGS` order. */
export const ISSUE_MEANINGS: readonly IssueMeaning[] = MAPPABLE_MEANINGS.filter(isIssueMeaning);
export const PR_MEANINGS: readonly PrMeaning[] = MAPPABLE_MEANINGS.filter(isPrMeaning);
