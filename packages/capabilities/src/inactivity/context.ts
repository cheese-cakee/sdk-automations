/** What a ladder is handed: it closes over nothing the record does not carry. */

import type { PlatformHandle, SettingsOf } from "@hiero-hackers/automation-core/author";
import type { InactivityDeclaration } from "./declaration.js";
import type { INACTIVITY_SETTINGS } from "./settings.js";

/** Everything this repository asked inactivity for, read and defaulted. */
export type InactivitySettings = SettingsOf<typeof INACTIVITY_SETTINGS>;

/** Everything a ladder judges with, so nothing is captured from `evaluate`. */
export interface LadderContext {
    readonly settings: InactivitySettings;
    /** When the record was read. Not always the occasion an intent is dated at. */
    readonly observedAt: Date;
    readonly platform: PlatformHandle<InactivityDeclaration>;
}

export function ladderContext(
    settings: InactivitySettings,
    facts: { readonly observedAt: Date },
    platform: PlatformHandle<InactivityDeclaration>,
): LadderContext {
    return {
        settings,
        observedAt: facts.observedAt,
        platform,
    };
}
