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

/** One unresolved `sent` journal row — the sweep's unit of work. */
export interface OpenIntent {
    readonly effectId: string;
    readonly seq: number;
    readonly intent: string;
    readonly attempt: number;
    readonly at: string;
}
