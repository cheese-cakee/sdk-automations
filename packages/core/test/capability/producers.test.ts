/**
 * The producer registry's own invariants — what has to hold of the table
 * before any producer or any declaration is judged against it.
 *
 * Whether each producer actually reads what its row promises is a question
 * about the producers, not the table, and it is asked generically over this
 * registry in `packages/runtime/test/producers.test.ts` — the one package that
 * can see both the webhook normalizers and the sweep's reader.
 */

import { describe, expect, it } from "vitest";
import {
    carriesFactGroup,
    FACT_GROUPS,
    FACT_KINDS,
    PRODUCER_NAMES,
    PRODUCERS,
    producerReads,
    producersReading,
    producesKind,
    WEBHOOK_PRODUCERS,
} from "../../src/capability/index.js";

describe("the producer registry", () => {
    it("is the webhook producers and the sweep, each with a row", () => {
        expect([...PRODUCER_NAMES]).toEqual([...WEBHOOK_PRODUCERS, "sweep"]);
        expect(Object.keys(PRODUCERS).sort()).toEqual([...PRODUCER_NAMES].sort());
    });

    /**
     * A row may not promise a group its kind does not carry. `review` on an
     * issue would be a promise no record could keep, and the boot check would
     * admit a declaration the engine could never invoke.
     */
    it("promises only groups the kind carries", () => {
        const impossible: string[] = [];
        for (const producer of PRODUCER_NAMES) {
            for (const kind of FACT_KINDS) {
                if (!producesKind(producer, kind)) continue;
                for (const group of FACT_GROUPS) {
                    if (!producerReads(producer, kind, group)) continue;
                    if (carriesFactGroup(kind, group)) continue;
                    impossible.push(`${producer}/${kind}: ${group}`);
                }
            }
        }
        expect(impossible).toEqual([]);
    });

    /**
     * Every group has a reader, which is what lets the boot refusal always end
     * by naming one. A group added to `FACT_GROUPS` before any producer fills
     * it would be a need nothing could ever answer, and the refusal a
     * capability got back would name nobody to move its trigger to.
     */
    it("leaves no group unread by every producer", () => {
        const orphans: string[] = [];
        for (const kind of FACT_KINDS) {
            for (const group of FACT_GROUPS) {
                if (!carriesFactGroup(kind, group)) continue;
                if (producersReading(kind, group).length > 0) continue;
                orphans.push(`${kind}: ${group}`);
            }
        }
        expect(orphans).toEqual([]);
    });

    it("answers the three questions the boot check asks", () => {
        // The negative control for each: a producer that makes no record of a
        // kind, and a group a producer that does make one still never reads.
        expect(producesKind("issues", "pullRequest")).toBe(false);
        expect(producerReads("issues", "pullRequest", "assignees")).toBe(false);
        expect(producerReads("pull_request", "pullRequest", "review")).toBe(false);
        expect(producerReads("sweep", "pullRequest", "review")).toBe(true);
        expect(producersReading("pullRequest", "review")).toEqual(["sweep"]);
    });
});
