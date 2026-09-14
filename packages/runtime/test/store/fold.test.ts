/**
 * The fold, held to the histories a real applier can write. The generator
 * simulates the applier's transitions — a send, then how that send closed —
 * cut short anywhere a crash could cut it, so a legal history is the only
 * input the properties assert over. Fixed seed: deterministic, and shrinking
 * on failure. The named cases below are the three rehearsal sequences.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { Fact, FactKind } from "../../src/store/facts.js";
import { fold } from "../../src/store/fold.js";

const SEED = 20260912;
const AT = "2026-09-12T09:00:00.000Z";
const ITEM = { kind: "issue", number: 40 } as const;
const REPOSITORY = { owner: "o", repo: "r" } as const;

/** The four facts that close an open send. */
const CLOSINGS = ["landed", "refused", "abandoned", "unsent"] as const;

/** The closings, and a resend of the open call after a lost answer. */
const STEPS = [...CLOSINGS, "resend"] as const;

type Step = (typeof STEPS)[number];

const factAt = (seq: number, kind: FactKind): Fact => ({
    effectId: "effect",
    seq,
    kind,
    at: AT,
    revision: "revision-1",
    capability: "inactivity",
    repository: REPOSITORY,
    item: ITEM,
    verb: kind === "warned" || kind === "reversed" ? null : "postComment",
    login: null,
    code: null,
    detail: null,
    payload: kind === "sent" ? `{"seq":${String(seq)}}` : null,
});

/** The facts one legal run appends: a send, then how it closed, seq by seq. */
function runOf(planLength: number, steps: readonly Step[]): Fact[] {
    const facts: Fact[] = [];
    let seq = 1;
    for (const closing of steps) {
        facts.push(factAt(seq, "sent"));
        if (closing === "resend") continue;
        facts.push(factAt(seq, closing));
        if (closing === "refused" || closing === "abandoned") break;
        if (closing === "landed") {
            if (seq === planLength) break;
            seq += 1;
        }
    }
    return facts;
}

interface Legal {
    readonly planLength: number;
    readonly facts: readonly Fact[];
}

/** A legal run, cut where a crash could cut it, with a `warned` fact anywhere in it. */
const legal: fc.Arbitrary<Legal> = fc
    .tuple(
        fc.integer({ min: 1, max: 4 }),
        fc.array(fc.constantFrom(...STEPS), { maxLength: 8 }),
        fc.nat(),
        fc.option(fc.nat(), { nil: undefined }),
    )
    .map(([planLength, closings, cut, warned]) => {
        const whole = runOf(planLength, closings);
        const facts = whole.slice(0, cut % (whole.length + 1));
        if (warned !== undefined) facts.splice(warned % (facts.length + 1), 0, factAt(0, "warned"));
        return { planLength, facts };
    });

const landedSeqs = (facts: readonly Fact[]): Set<number> =>
    new Set(facts.filter((fact) => fact.kind === "landed").map((fact) => fact.seq));

describe("the fold over legal histories", () => {
    it("generates every state a legal history can reach, and a spent attempt", () => {
        const reached = new Set<string>();
        let attempts = 0;
        fc.assert(
            fc.property(legal, ({ planLength, facts }) => {
                const state = fold(facts, planLength);
                reached.add(state.kind === "settled" ? `settled:${state.how}` : state.kind);
                if (state.kind === "open") attempts = Math.max(attempts, state.attempts);
            }),
            { seed: SEED, numRuns: 1000 },
        );
        expect([...reached].sort()).toEqual([
            "neverStarted",
            "open",
            "resumable",
            "settled:abandoned",
            "settled:landed",
            "settled:refused",
        ]);
        expect(attempts).toBeGreaterThan(1);
    });

    it("says landed only when every seq in the plan landed", () => {
        fc.assert(
            fc.property(legal, ({ planLength, facts }) => {
                const state = fold(facts, planLength);
                if (state.kind !== "settled" || state.how !== "landed") return;
                const landed = landedSeqs(facts);
                for (let seq = 1; seq <= planLength; seq += 1) {
                    expect(landed.has(seq), `seq ${String(seq)} landed`).toBe(true);
                }
            }),
            { seed: SEED, numRuns: 1000 },
        );
    });

    it("counts an open send's attempts as the sends at that seq, less the unsent", () => {
        fc.assert(
            fc.property(legal, ({ planLength, facts }) => {
                const state = fold(facts, planLength);
                if (state.kind !== "open") return;
                const atSeq = (kind: FactKind): number =>
                    facts.filter((fact) => fact.kind === kind && fact.seq === state.seq).length;
                expect(state.attempts).toBe(atSeq("sent") - atSeq("unsent"));
            }),
            { seed: SEED, numRuns: 1000 },
        );
    });

    it("admits no continuation once an effect is settled", () => {
        fc.assert(
            fc.property(
                legal,
                fc.integer({ min: 1, max: 4 }),
                fc.constantFrom(...CLOSINGS, "sent" as const),
                ({ planLength, facts }, seq, kind) => {
                    const state = fold(facts, planLength);
                    if (state.kind !== "settled") return;
                    const continued = fold([...facts, factAt(seq, kind)], planLength);
                    expect(continued.kind).toBe("inconsistent");
                },
            ),
            { seed: SEED, numRuns: 1000 },
        );
    });

    it("calls no legal history inconsistent", () => {
        fc.assert(
            fc.property(legal, ({ planLength, facts }) => {
                expect(fold(facts, planLength).kind).not.toBe("inconsistent");
            }),
            { seed: SEED, numRuns: 1000 },
        );
    });

    it("cannot be made to say landed by losing one fact", () => {
        fc.assert(
            fc.property(legal, fc.nat(), ({ planLength, facts }, pick) => {
                // A landed, or the only send at its seq: a retried send has a twin to stand in.
                const sends = (seq: number): number =>
                    facts.filter((fact) => fact.kind === "sent" && fact.seq === seq).length;
                const removable = facts
                    .map((fact, index) => ({ fact, index }))
                    .filter(
                        ({ fact }) =>
                            fact.kind === "landed" ||
                            (fact.kind === "sent" && sends(fact.seq) === 1),
                    );
                if (facts.length < 2 || removable.length === 0) return;
                const gone = removable[pick % removable.length]!.index;
                const state = fold(
                    facts.filter((_, index) => index !== gone),
                    planLength,
                );
                expect(state.kind === "settled" && state.how === "landed").toBe(false);
            }),
            { seed: SEED, numRuns: 1000 },
        );
    });
});

describe("the states the table names", () => {
    it("says neverStarted for no facts, and for a warning alone", () => {
        expect(fold([], 2)).toEqual({ kind: "neverStarted" });
        expect(fold([factAt(0, "warned")], 2)).toEqual({ kind: "neverStarted" });
    });

    it("says open while a send has not closed, with the call's bytes", () => {
        expect(fold([factAt(1, "sent")], 2)).toEqual({
            kind: "open",
            seq: 1,
            payload: '{"seq":1}',
            attempts: 1,
        });
    });

    it("says resumable when the plan has more calls to make", () => {
        expect(fold([factAt(1, "sent"), factAt(1, "landed")], 2)).toEqual({
            kind: "resumable",
            nextSeq: 2,
        });
    });

    it("counts a resend as a retry and an unsent as none", () => {
        const sent = factAt(1, "sent");
        expect(fold([sent, sent], 2)).toMatchObject({ kind: "open", attempts: 2 });
        expect(fold([sent, factAt(1, "unsent"), sent], 2)).toMatchObject({
            kind: "open",
            attempts: 1,
        });
    });

    it("refuses a send at a later seq while an earlier one is open or unlanded", () => {
        expect(fold([factAt(1, "sent"), factAt(2, "sent")], 2).kind).toBe("inconsistent");
        expect(fold([factAt(1, "sent"), factAt(1, "unsent"), factAt(2, "sent")], 2).kind).toBe(
            "inconsistent",
        );
    });

    it("says resumable at the same seq after an unsent call", () => {
        expect(fold([factAt(1, "sent"), factAt(1, "unsent")], 2)).toEqual({
            kind: "resumable",
            nextSeq: 1,
        });
    });

    it("treats a reversed fact as the effect's, never a call's", () => {
        expect(fold([factAt(0, "reversed")], 2)).toEqual({ kind: "neverStarted" });
    });

    it("names the seq a call fact falls outside the plan at, either side", () => {
        expect(fold([factAt(0, "sent")], 2)).toEqual({
            kind: "inconsistent",
            detail: "seq 0 is outside the plan's 2",
        });
        expect(fold([factAt(3, "sent")], 2)).toEqual({
            kind: "inconsistent",
            detail: "seq 3 is outside the plan's 2",
        });
    });

    it("names the open seq a second send collided with", () => {
        expect(fold([factAt(1, "sent"), factAt(2, "sent")], 2)).toEqual({
            kind: "inconsistent",
            detail: "a send at seq 2 while seq 1 was open",
        });
    });

    it("names a closing fact whose seq is not the open one", () => {
        expect(fold([factAt(1, "sent"), factAt(2, "landed")], 2)).toEqual({
            kind: "inconsistent",
            detail: "a landed at seq 2 closes no open send",
        });
    });

    it("says settled when the last call in the plan landed", () => {
        const facts = [
            factAt(1, "sent"),
            factAt(1, "landed"),
            factAt(2, "sent"),
            factAt(2, "landed"),
        ];
        expect(fold(facts, 2)).toEqual({ kind: "settled", how: "landed", seq: 2 });
    });

    it("says inconsistent for a send at another seq while one is open, and for a seq past the plan", () => {
        expect(fold([factAt(1, "sent"), factAt(2, "sent")], 2).kind).toBe("inconsistent");
        expect(fold([factAt(2, "sent")], 1).kind).toBe("inconsistent");
    });

    it("says inconsistent for a closing fact that closes nothing", () => {
        expect(fold([factAt(1, "landed")], 1).kind).toBe("inconsistent");
    });
});

describe("the three rehearsal sequences", () => {
    it("settles a refusal, and refuses to continue to the notice", () => {
        const refused = [factAt(1, "sent"), factAt(1, "refused")];
        expect(fold(refused, 2)).toEqual({ kind: "settled", how: "refused", seq: 1 });
        expect(fold([...refused, factAt(2, "sent")], 2)).toEqual({
            kind: "inconsistent",
            detail: "a sent arrived after the effect settled",
        });
    });

    it("settles an abandoned call the same way", () => {
        const abandoned = [factAt(1, "sent"), factAt(1, "abandoned")];
        expect(fold(abandoned, 2)).toEqual({ kind: "settled", how: "abandoned", seq: 1 });
        expect(fold([...abandoned, factAt(2, "sent")], 2).kind).toBe("inconsistent");
    });

    it("calls a landing at seq 2 without seq 1 inconsistent", () => {
        expect(fold([factAt(2, "sent"), factAt(2, "landed")], 2)).toEqual({
            kind: "inconsistent",
            detail: "seq 2 sent with seq 1 unlanded",
        });
    });
});
