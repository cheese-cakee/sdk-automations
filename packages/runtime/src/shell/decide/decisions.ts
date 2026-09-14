/**
 * Which rows one decided pass writes down: a verdict per item finding, one per effect (D163).
 * A judgement only — appending them is the box's, and the store's `decide` is one row each.
 */

import type { Finding, Report, RepositoryRef, Subject } from "@hiero-hackers/automation-core";
import type { Decision } from "../../store/index.js";
import type { EffectOutcome } from "../effects.js";

/** One decided pass, as its rows name it. */
export interface DecidedPass {
    readonly passId: string;
    /** Which lane caused the pass, and the delivery or schedule row it names (D173). */
    readonly source: Decision["source"];
    readonly sourceId: string;
    /** The repository the process served this pass for (D169). */
    readonly repository: RepositoryRef;
    readonly at: string;
    readonly report: Report;
    readonly effects: readonly EffectOutcome[];
}

/** The subjects a row is written about: one item, or one act on it. */
type ItemSubject = Extract<Subject, { readonly kind: "item" | "effect" }>;

const aboutAnItem = (finding: Finding): finding is Finding & { readonly subject: ItemSubject } =>
    finding.subject.kind === "item" || finding.subject.kind === "effect";

/**
 * Every row one pass writes: its item verdicts in report order, then its effects.
 * A record with no item finding and no effect writes none — a config rejection has no item.
 */
export function decisionsOf(pass: DecidedPass): Decision[] {
    const common = {
        passId: pass.passId,
        source: pass.source,
        sourceId: pass.sourceId,
        at: pass.at,
        repository: pass.repository,
    };
    return [
        ...pass.report.findings.filter(aboutAnItem).map((finding) => ({
            ...common,
            item: finding.subject.item,
            capability: finding.subject.capability,
            verdict: finding.severity,
            code: finding.code,
            detail: finding.summary,
            effectId: null,
        })),
        ...pass.effects.map((outcome) => ({
            ...common,
            item: outcome.item,
            capability: outcome.capability,
            verdict: outcome.outcome,
            code: outcome.code,
            detail: outcome.detail,
            effectId: outcome.effectId,
        })),
    ];
}
