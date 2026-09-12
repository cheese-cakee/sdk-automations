/**
 * What a ladder is handed. The ladders close over nothing: every fact they
 * need arrives on this context or on the record itself.
 */

import {
    intentFactoryFor,
    type ItemRef,
    type PlatformHandle,
    type RepositoryRef,
    type SettingsOf,
} from "@hiero-hackers/automation-core";
import { inactivityDeclaration, type InactivityDeclaration } from "./declaration.js";
import { INACTIVITY_SETTINGS } from "./settings.js";

/** Everything this repository asked inactivity for, read and defaulted. */
export type InactivitySettings = SettingsOf<typeof INACTIVITY_SETTINGS>;

/** One occasion's intent maker: only this declaration's operations compile. */
export type MakeIntent = ReturnType<typeof intentFactoryFor<InactivityDeclaration>>;

/** Everything a ladder judges with, so nothing is captured from `evaluate`. */
export interface LadderContext {
    readonly settings: InactivitySettings;
    /** When the record was read. Not always the occasion an intent is dated at. */
    readonly observedAt: Date;
    readonly platform: PlatformHandle<InactivityDeclaration>;
    /** Bind one item and one occasion; an act dates itself, not the sweep. */
    make(item: ItemRef, occasion: Date): MakeIntent;
}

export function ladderContext(
    settings: InactivitySettings,
    facts: { readonly repository: RepositoryRef; readonly observedAt: Date },
    platform: PlatformHandle<InactivityDeclaration>,
): LadderContext {
    return {
        settings,
        observedAt: facts.observedAt,
        platform,
        make: (item, occasion) =>
            intentFactoryFor(inactivityDeclaration, {
                repository: facts.repository,
                item,
                observedAt: occasion,
            }),
    };
}
