/**
 * Building an intent — capability-authoring ergonomics, owned (D92 3d).
 *
 * The factory binds the occasion once, so each intent states only what it
 * WANTS. An omitted `claims` is vacuous (`closed: null`), never an assertion.
 */

import type { TypedDeclaration } from "./declaration.js";
import type { ItemRef, RepositoryRef } from "./catalogue.js";
import type { IntentCatalogue, IntentOperation } from "./catalogue.js";
import { deriveIdempotencyKey, type DestructiveGrace, type Intent } from "./intent.js";
import type { ClaimedFacts } from "../safety/index.js";

/** Where and when — bound once per evaluation, not restated per intent. */
export interface IntentOccasion {
    readonly repository: RepositoryRef;
    readonly item: ItemRef;
    readonly observedAt: Date;
}

/** What a capability says; the factory supplies the rest of the intent. */
export interface IntentSpec<K extends IntentOperation> {
    readonly operation: K;
    readonly desired: IntentCatalogue[K];
    /** What occasioned this — free text identifying the trigger, dated by the occasion. */
    readonly cause: string;
    /** Omitted fields claim nothing; `closed` defaults to no-claim, not open. */
    readonly claims?: Partial<ClaimedFacts>;
    readonly explain: { readonly summary: string; readonly detail?: readonly string[] };
    /** Stated by a clock-triggered destructive act and by nothing else (grace.md §1). */
    readonly grace?: DestructiveGrace;
}

/** A spec-to-intent function with one occasion already bound. */
export type IntentMaker = <K extends IntentOperation>(spec: IntentSpec<K>) => Intent<K>;

/** Bind an occasion. Accepts any catalogue operation; see `intentFactoryFor`. */
export function intentFactory(capability: string, occasion: IntentOccasion): IntentMaker {
    return <K extends IntentOperation>(spec: IntentSpec<K>): Intent<K> => {
        const base = {
            capability,
            repository: occasion.repository,
            item: occasion.item,
            operation: spec.operation,
            claims: {
                meaningsPresent: spec.claims?.meaningsPresent ?? [],
                meaningsAbsent: spec.claims?.meaningsAbsent ?? [],
                closed: spec.claims?.closed ?? null,
                // Written in only when claimed: a key spelled `undefined` would
                // not match the same intent built from bytes.
                ...(spec.claims?.pullRequestMode === undefined
                    ? {}
                    : { pullRequestMode: spec.claims.pullRequestMode }),
            },
            desired: spec.desired,
            cause: { cause: spec.cause, observedAt: occasion.observedAt },
            explanation: {
                capability,
                summary: spec.explain.summary,
                detail: spec.explain.detail ?? [],
            },
            grace: spec.grace ?? null,
        };
        return {
            ...base,
            idempotencyKey: deriveIdempotencyKey(base),
        };
    };
}

/** The declaration-aware factory — the one capabilities should use. */
export function intentFactoryFor<const D extends TypedDeclaration>(
    declaration: D,
    occasion: IntentOccasion,
): <K extends D["intents"][number]>(spec: IntentSpec<K>) => Intent<K> {
    return intentFactory(declaration.name, occasion);
}
