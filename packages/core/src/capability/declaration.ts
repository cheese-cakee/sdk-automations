/**
 * What a capability declares about itself, and the one admission path for the
 * complete set the platform ships.
 */

import {
    CAPABILITY_NAME_PATTERN,
    COMMANDS,
    MAPPABLE_MEANINGS,
    MAPPING_FAMILIES,
    SKILL_TIERS,
} from "../config/schema.js";
import type { MappingFamily, RequiredMappings } from "../config/schema.js";
import type { FactGroup, FactKind, IntentOperation, ResolverName } from "./catalogue.js";
import { carriesFactGroup, FACT_GROUPS, FACT_KINDS, RESOLVER_NAMES } from "./catalogue.js";
import { INTENT_OPERATIONS } from "./operations/index.js";
import type { ProducerName } from "./producers.js";
import type { Spec } from "./spec.js";
import {
    isWebhookProducer,
    producerReads,
    producersReading,
    producesKind,
    WEBHOOK_PRODUCERS,
} from "./producers.js";

/**
 * contract.md §1 triggers: what a capability wants to be woken for. A trigger
 * names a producer, so a declared need is answerable at boot (`producers.ts`).
 */
export type DeclaredTrigger =
    | { readonly kind: "event"; readonly event: string }
    | { readonly kind: "schedule"; readonly description: string };

/** What a capability needs from the platform to run at all — contract.md §1. */
export interface OperationalNeeds {
    readonly schedule: boolean;
    readonly durableState: "none" | "candidate" | "required";
    readonly crossItemCoordination: boolean;
    readonly externalDelivery: boolean;
}

/** The three mapping families a declaration may demand, unnarrowed. */
export interface DeclaredMappings {
    readonly labels?: readonly string[];
    readonly commands?: readonly string[];
    readonly skills?: readonly string[];
}

/**
 * A capability's self-description — contract.md §1. `settings` and
 * `requiredMappings` are empty rather than absent when neither is wanted (D84).
 */
export interface CapabilityDeclaration {
    readonly name: string;
    readonly triggers: readonly DeclaredTrigger[];
    readonly settings: Spec;
    readonly requiredMappings: DeclaredMappings;
    readonly facts: readonly string[];
    readonly needs: readonly string[];
    readonly resolvers: readonly string[];
    readonly intents: readonly string[];
    readonly operationalNeeds: OperationalNeeds;
}

/** A declaration whose names are catalogue keys — the shape `parseConfig` admits. */
export interface TypedDeclaration extends CapabilityDeclaration {
    readonly requiredMappings: RequiredMappings;
    readonly facts: readonly FactKind[];
    readonly needs: readonly FactGroup[];
    readonly resolvers: readonly ResolverName[];
    readonly intents: readonly IntentOperation[];
}

/**
 * Pins `facts`, `needs`, `resolvers`, and `intents` as literal tuples. Declare
 * capabilities through this, never by annotating them `: TypedDeclaration`.
 */
export function declareCapability<const D extends TypedDeclaration>(d: D): D {
    return d;
}

function duplicates(values: readonly string[]): string[] {
    const seen = new Set<string>();
    const dup = new Set<string>();
    for (const v of values) (seen.has(v) ? dup : seen).add(v);
    return [...dup];
}

/**
 * Is the declaration structurally sound, judged without the catalogues?
 * Returns every violation rather than the first.
 */
function validateDeclaration(d: CapabilityDeclaration): readonly string[] {
    const errors: string[] = [];
    const at = `capability "${d.name}"`;

    if (!CAPABILITY_NAME_PATTERN.test(d.name)) {
        errors.push(
            `declaration name ${JSON.stringify(d.name)} must be a camelCase configuration key`,
        );
    }
    if (d.triggers.length === 0) {
        errors.push(
            `${at}: at least one trigger (event or schedule) is required — an untriggerable capability is dead code`,
        );
    }
    if (d.triggers.some((t) => t.kind === "schedule") && !d.operationalNeeds.schedule) {
        errors.push(`${at}: declares a schedule trigger but operationalNeeds.schedule is false`);
    }

    if (Object.hasOwn(d.settings, "enabled")) {
        errors.push(
            `${at}: settings may not declare "enabled" — it is consent on the capability's own block, whose other keys are the settings`,
        );
    }

    // No `settings` row: a spec's keys are unique by construction.
    const lists: (readonly [string, readonly string[]])[] = [
        ["facts", d.facts],
        ["needs", d.needs],
        ["resolvers", d.resolvers],
        ["intents", d.intents],
        ...MAPPING_FAMILIES.map(
            (family) => [`requiredMappings.${family}`, d.requiredMappings[family] ?? []] as const,
        ),
    ];
    for (const [what, entries] of lists) {
        for (const dup of duplicates(entries)) {
            errors.push(`${at}: duplicate ${what} entry "${dup}"`);
        }
    }

    return errors;
}

/** The closed meaning set of each family, for the requirement check below. */
const FAMILY_MEANINGS: { readonly [F in MappingFamily]: readonly string[] } = {
    labels: MAPPABLE_MEANINGS,
    commands: COMMANDS,
    skills: SKILL_TIERS,
};

function isFactKind(name: string): name is FactKind {
    return FACT_KINDS.some((kind) => kind === name);
}

function isFactGroup(name: string): name is FactGroup {
    return FACT_GROUPS.some((group) => group === name);
}

function isIntentOperation(name: string): name is IntentOperation {
    return Object.hasOwn(INTENT_OPERATIONS, name);
}

/** Do the declared meaning, fact, resolver, and intent names exist? */
function checkAgainstCatalogue(declaration: CapabilityDeclaration): readonly string[] {
    const errors: string[] = [];
    const at = `capability "${declaration.name}"`;

    for (const family of MAPPING_FAMILIES) {
        for (const meaning of declaration.requiredMappings[family] ?? []) {
            if (FAMILY_MEANINGS[family].some((name) => name === meaning)) continue;
            errors.push(`${at}: required meaning "${meaning}" is not in the ${family} family`);
        }
    }
    for (const fact of declaration.facts) {
        if (!isFactKind(fact)) {
            errors.push(`${at}: fact kind "${fact}" is not in the fact catalogue`);
        }
    }
    // facts.md §3: a need is satisfiable only if some declared kind carries the group.
    const kinds = declaration.facts.filter(isFactKind);
    for (const need of declaration.needs) {
        if (!isFactGroup(need)) {
            errors.push(`${at}: fact group "${need}" is not in the fact catalogue`);
        } else if (!kinds.some((kind) => carriesFactGroup(kind, need))) {
            errors.push(`${at}: no declared fact kind carries the group "${need}"`);
        }
    }
    for (const resolver of declaration.resolvers) {
        if (!RESOLVER_NAMES.some((name) => name === resolver)) {
            errors.push(`${at}: resolver "${resolver}" is not in the resolver catalogue`);
        }
    }
    for (const intent of declaration.intents) {
        if (!isIntentOperation(intent)) {
            errors.push(`${at}: intent "${intent}" is not in the operation catalogue`);
        }
    }
    return errors;
}

/**
 * Every need this producer leaves unread, as errors: the engine records
 * `factsUnread` and skips every delivery the trigger wakes, in silence.
 */
function needsUnreadBy(
    declaration: CapabilityDeclaration,
    producer: ProducerName,
    trigger: string,
): readonly string[] {
    const errors: string[] = [];
    for (const kind of declaration.facts.filter(isFactKind)) {
        if (!producesKind(producer, kind)) continue;
        for (const need of declaration.needs.filter(isFactGroup)) {
            if (!carriesFactGroup(kind, need)) continue;
            if (producerReads(producer, kind, need)) continue;
            errors.push(
                `capability "${declaration.name}": ${trigger} leaves "${need}" unread on a ${kind} record, so every delivery it wakes is skipped — read by: ${producersReading(kind, need).join(", ")}`,
            );
        }
    }
    return errors;
}

/** Is every declared need answered by the producer each trigger wakes? */
function checkAgainstProducers(declaration: CapabilityDeclaration): readonly string[] {
    const errors: string[] = [];
    for (const trigger of declaration.triggers) {
        if (trigger.kind === "schedule") {
            errors.push(...needsUnreadBy(declaration, "sweep", "the schedule trigger"));
            continue;
        }
        if (!isWebhookProducer(trigger.event)) {
            errors.push(
                `capability "${declaration.name}": no producer wakes on the "${trigger.event}" trigger — the events the platform consumes are ${WEBHOOK_PRODUCERS.join(", ")}`,
            );
            continue;
        }
        errors.push(...needsUnreadBy(declaration, trigger.event, `the "${trigger.event}" trigger`));
    }
    return errors;
}

/** Validate the complete direct capability set; returns every error. */
export function validateCapabilityDeclarations(
    declarations: readonly CapabilityDeclaration[],
): readonly string[] {
    const errors = declarations.flatMap((declaration) => [
        ...validateDeclaration(declaration),
        ...checkAgainstCatalogue(declaration),
        ...checkAgainstProducers(declaration),
    ]);
    for (const name of duplicates(declarations.map((declaration) => declaration.name))) {
        errors.push(`duplicate capability name "${name}"`);
    }
    return errors;
}
