/**
 * What the platform decided, and why — the record every explanation lands in.
 * The list is FLAT: four surfaces are views of it and they group differently.
 */

import type { ItemRef, RepositoryRef } from "../capability/index.js";
import type { RepositoryMode } from "../config/index.js";

/** `info`: it happened and was normal. `notice`: nothing happened, as intended. `problem`: act. */
export type Severity = "info" | "notice" | "problem";

/** What a finding is ABOUT — typed, not a string, because every consumer groups by it. */
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

/** One thing that happened, and who it concerns. Consumers group by `code`, never `summary` (D75). */
export interface Finding {
    readonly severity: Severity;
    readonly code: string;
    /** One sentence, for a human. Never asserted on by tests, only its presence. */
    readonly summary: string;
    readonly detail: readonly string[];
    readonly subject: Subject;
}

/**
 * One evaluation pass, or one configuration read. `revision` is required: a
 * report that cannot say which configuration it describes is not evidence.
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

/** Group for rendering. Entries, not a record, so the caller keeps insertion order. */
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
