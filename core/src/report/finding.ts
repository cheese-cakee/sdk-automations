/**
 * What the platform decided, and why — the record every explanation lands in.
 *
 * Core already produced one for every decision it made and dropped all of it,
 * so the dry-run report, the configuration report (D38), the operator surface
 * (D44, D45) and goal 5's managed comment were each waiting on a sink that did
 * not exist. All four are views of this one list.
 *
 * FLAT, deliberately: the four consumers group differently, and a shape that
 * favours one makes the others awkward.
 */

import type { ItemRef, RepositoryRef } from "../capability/index.js";
import type { RepositoryMode } from "../config/index.js";

/**
 * Three levels, chosen for what a MAINTAINER must do rather than how bad it
 * sounds — the distinction an operator surface has to make first.
 *
 * `info`: it happened and it was normal. `notice`: nothing happened and
 * that was intended — a dry-run record, a disabled capability, a skipped
 * item. `problem`: a human has to act.
 */
export type Severity = "info" | "notice" | "problem";

/**
 * What a finding is ABOUT. Every consumer groups by one of these, which is
 * why the subject is typed rather than a string: the config report filters
 * to `configuration`, the operator surface to `effect`, a managed comment to
 * one `item`.
 */
export type Subject =
    | { readonly kind: "repository" }
    | {
          readonly kind: "configuration";
          /** Dotted path into the reviewed file, when one applies. */
          readonly path: string | null;
      }
    | { readonly kind: "capability"; readonly capability: string }
    | {
          readonly kind: "item";
          readonly capability: string;
          readonly item: ItemRef;
      }
    | {
          readonly kind: "effect";
          readonly capability: string;
          readonly item: ItemRef;
          readonly operation: string;
      };

export interface Finding {
    readonly severity: Severity;
    /**
     * Machine-readable, and the reason D75 matters: a consumer groups,
     * counts, links and localises by this. Every refusal in core already
     * carries one — configuration errors are the exception, and they are
     * exactly the findings D38's config report most needs to organise.
     */
    readonly code: string;
    /** One sentence, for a human. Never asserted on by tests, only its presence. */
    readonly summary: string;
    readonly detail: readonly string[];
    readonly subject: Subject;
}

/**
 * One evaluation pass, or one configuration read — whatever produced the
 * findings.
 *
 * `revision` is the configuration the pass ran under. It is required rather
 * than optional because a report that cannot say which configuration it
 * describes is not evidence of anything, and the same string is what the
 * executor guards in-flight effects on.
 */
export interface Report {
    readonly revision: string;
    readonly mode: RepositoryMode;
    readonly repository: RepositoryRef;
    readonly findings: readonly Finding[];
}

/** Pure constructor, so every finding is built the same way. */
export function finding(
    severity: Severity,
    code: string,
    summary: string,
    subject: Subject,
    detail: readonly string[] = [],
): Finding {
    return { severity, code, summary, subject, detail };
}

/** Findings a maintainer must act on. The operator surface's whole job. */
export function problems(report: Report): readonly Finding[] {
    return report.findings.filter((f) => f.severity === "problem");
}

/**
 * Group for rendering. Returns entries rather than a record so the caller
 * keeps insertion order — a report reads in the order decisions were made,
 * and re-sorting it loses the only narrative it has.
 */
export function groupBy(
    report: Report,
    key: (f: Finding) => string,
): readonly (readonly [string, readonly Finding[]])[] {
    const out = new Map<string, Finding[]>();
    for (const f of report.findings) {
        const k = key(f);
        const bucket = out.get(k);
        if (bucket === undefined) out.set(k, [f]);
        else bucket.push(f);
    }
    return [...out.entries()];
}
