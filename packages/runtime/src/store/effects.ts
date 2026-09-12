/** What an effect is, and what state its journal says it is in. Vocabulary only. */

/**
 * The recovery classification derived from an effect's latest journal row.
 * `attempt` is durable across crashes, so a restart does not reset the bound (D42).
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
 * Deliberately NOT a `DestructiveWarning`: the shell re-mints one through `createDestructiveWarning`, so bytes become authority only by passing back through it.
 */
export interface StoredWarning {
    readonly effectId: string;
    readonly warnedAt: string;
    readonly gracePeriodHours: number;
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
