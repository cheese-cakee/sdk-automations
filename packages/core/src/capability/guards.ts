/** The guard kit: three stops, guards in flowchart order — capability-kits.md §2, D143. */

import type { PlatformHandle } from "./boundary.js";
import type { TypedDeclaration } from "./declaration.js";

/** Stop and say why on the operator surface: one explanation, no intents. */
export function skipped<D extends TypedDeclaration>(
    platform: PlatformHandle<D>,
    capability: string,
    summary: string,
    ...detail: readonly string[]
): readonly never[] {
    platform.explain({ capability, summary, detail });
    return [];
}
