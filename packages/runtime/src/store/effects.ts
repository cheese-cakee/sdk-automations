/**
 * What an effect is, and what state its journal says it is in.
 *
 * Vocabulary only. `store.ts` owns the journal writes and the
 * classification that produces these values; `deliveries.ts` and
 * `schedules.ts` are the sibling vocabularies.
 */

/**
 * The recovery classification derived from an effect's latest journal row.
 *
 * `attempt` is durable across crashes, not per-process. A restarted
 * process therefore hands `retryAdvice` a truthful attempt number instead
 * of restarting the bound at zero (D42).
 */
export type EffectState =
    | { readonly state: "neverStarted" }
    | {
          readonly state: "complete";
          readonly lastDoneSeq: number;
          readonly revision: string;
      }
    | {
          readonly state: "midSequence";
          readonly lastDoneSeq: number;
          readonly revision: string;
      }
    | {
          readonly state: "sentUnknown";
          readonly seq: number;
          readonly intent: string;
          readonly attempt: number;
          readonly revision: string;
      };

/**
 * One recorded destructive warning, as the row holds it (grace.md §4).
 *
 * Plain data, keyed by the ACT's effect id: instants are ISO text and the six
 * snapshot fields are the request the warning authorises. It is deliberately
 * NOT a `DestructiveWarning` — that type has one constructor and a brand
 * nothing outside core can forge, which is the point. The shell re-mints one
 * from this, so bytes that crossed a durability boundary become authority only
 * by passing back through `createDestructiveWarning`.
 */
export interface StoredWarning {
    readonly effectId: string;
    readonly warnedAt: string;
    readonly gracePeriodDays: number;
    readonly earliestActionAt: string;
    readonly cancelledBy: string;
    readonly reversesWith: string;
    readonly actionClass: string;
    readonly capability: string;
    readonly causeObservedAt: string;
    readonly cause: string;
    readonly item: string;
    readonly change: string;
}

/** One unresolved `sent` journal row — the sweep's unit of work. */
export interface OpenIntent {
    readonly effectId: string;
    readonly seq: number;
    readonly intent: string;
    readonly attempt: number;
    readonly at: string;
    readonly revision: string;
}
