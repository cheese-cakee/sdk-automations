/**
 * The one reading of an effect's facts: where it stands, and whether its history is possible.
 * Pure — no row and no clock, so the same facts always answer the same way.
 */

import type { Fact, LedgerState } from "./facts.js";

const broken = (detail: string): LedgerState => ({ kind: "inconsistent", detail });

/** A fact about the effect rather than about one of its calls. */
const effectLevel = (kind: Fact["kind"]): kind is "warned" | "reversed" =>
    kind === "warned" || kind === "reversed";

/** The first seq below this one that never landed. */
function gapBefore(seq: number, landed: ReadonlySet<number>): number | null {
    for (let earlier = 1; earlier < seq; earlier += 1) {
        if (!landed.has(earlier)) return earlier;
    }
    return null;
}

/**
 * Fold facts in ledger order into the state a pass may act on (D161).
 * `attempts` is the sends at that seq less its `unsent` ones (D160); a resend at the open seq is a retry.
 */
export function fold(facts: readonly Fact[], planLength: number): LedgerState {
    const landed = new Set<number>();
    const attempts = new Map<number, number>();
    let open: Fact | null = null;
    let settled: LedgerState | null = null;
    let anyCall = false;

    for (const fact of facts) {
        if (effectLevel(fact.kind)) continue;
        anyCall = true;
        if (settled !== null) return broken(`a ${fact.kind} arrived after the effect settled`);
        if (fact.seq < 1 || fact.seq > planLength) {
            return broken(`seq ${String(fact.seq)} is outside the plan's ${String(planLength)}`);
        }

        if (fact.kind === "sent") {
            if (open !== null && open.seq !== fact.seq) {
                return broken(
                    `a send at seq ${String(fact.seq)} while seq ${String(open.seq)} was open`,
                );
            }
            const gap = gapBefore(fact.seq, landed);
            if (gap !== null) {
                return broken(`seq ${String(fact.seq)} sent with seq ${String(gap)} unlanded`);
            }
            open = fact;
            attempts.set(fact.seq, (attempts.get(fact.seq) ?? 0) + 1);
            continue;
        }

        if (open === null || open.seq !== fact.seq) {
            return broken(`a ${fact.kind} at seq ${String(fact.seq)} closes no open send`);
        }
        open = null;

        if (fact.kind === "landed") {
            landed.add(fact.seq);
            if (fact.seq === planLength) {
                settled = { kind: "settled", how: "landed", seq: fact.seq };
            }
            continue;
        }
        if (fact.kind === "unsent") {
            attempts.set(fact.seq, attempts.get(fact.seq)! - 1);
        } else {
            settled = { kind: "settled", how: fact.kind, seq: fact.seq };
        }
    }

    if (settled !== null) return settled;
    if (open !== null) {
        const spent = attempts.get(open.seq)!;
        return { kind: "open", seq: open.seq, payload: open.payload, attempts: spent };
    }
    if (!anyCall) return { kind: "neverStarted" };
    return { kind: "resumable", nextSeq: landed.size + 1 };
}
