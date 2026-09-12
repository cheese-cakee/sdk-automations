/**
 * The guard kit — `design/guides/capability-kits.md` §2.
 *
 * One helper and two rules. A capability decides by stopping, and every stop
 * it makes is one of three things: SILENT, an OPERATOR NOTE, or a COMMENT to
 * the person. Only the last writes. A silent stop is `return []` or
 * `continue`; an operator note is `skipped`, the one stop that needs anything
 * but ordinary control flow; a comment refusal is an ordinary intent through
 * the factory. The three are separate because a skip that explained where the
 * design says nothing is a behaviour change, and the capabilities' own suites
 * pin the difference.
 *
 * The second rule is order: guards are written in the order the capability's
 * design flowchart reads its diamonds, so a reviewer can hold one against the
 * other. That is a review rule, not a type — the first promotion measured the
 * type and it cost only re-reads (D143).
 *
 * `settings.ts` is the shape's other half and its `unusable` is the settings
 * caption's own stop, written through this helper; `boundary.ts` owns the
 * handle a skip explains through, and `factory.ts` the factory a refusal is
 * built with.
 */

import type { PlatformHandle } from "./boundary.js";
import type { TypedDeclaration } from "./declaration.js";

/**
 * Stop and say why on the operator surface: one explanation, no intents.
 *
 * The empty list is typed `readonly never[]` so `return skipped(…)` is
 * assignable wherever an `evaluate` returns its own intent union. The
 * capability's name is passed rather than read, because a handle carries the
 * platform's surface and not the identity of who is speaking through it.
 */
export function skipped<D extends TypedDeclaration>(
    platform: PlatformHandle<D>,
    capability: string,
    summary: string,
    ...detail: readonly string[]
): readonly never[] {
    platform.explain({ capability, summary, detail });
    return [];
}
