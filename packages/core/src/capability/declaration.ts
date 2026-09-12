/**
 * What a capability declares about itself, and the one admission path for the
 * complete set the platform ships. `boundary.ts` invokes an admitted
 * capability; the platform catalogues remain authoritative for operation facts.
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
import {
    isWebhookProducer,
    producerReads,
    producersReading,
    producesKind,
    WEBHOOK_PRODUCERS,
} from "./producers.js";

/**
 * contract.md §1 triggers, split into the two real shapes.
 *
 * Not the catalogue's `Trigger`, which is what actually woke the platform for
 * one record. This is what a capability says it wants to be woken FOR.
 *
 * A trigger NAMES A PRODUCER — an event the webhook producer of that event, a
 * schedule the sweep — which is what makes a declared need answerable at boot
 * rather than at the first delivery (`producers.ts`).
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

/**
 * The three mapping families a declaration may demand, unnarrowed — an
 * external declaration is validated against the catalogues, never trusted to
 * have named them correctly.
 */
export interface DeclaredMappings {
    readonly labels?: readonly string[];
    readonly commands?: readonly string[];
    readonly skills?: readonly string[];
}

/**
 * A capability's self-description — `design/contracts/contract.md` §1.
 *
 * `configKeys` and `requiredMappings` are the two the CONFIGURATION layer
 * reads: the first says which `settings` names are legal, the second which
 * meanings must be mapped, by family, before the capability may be enabled.
 * Both are empty rather than absent for a capability that wants neither, so
 * "declares nothing" is a written answer instead of a forgotten field (D84).
 *
 * `facts` and `needs` are the two the ENGINE reads (contracts/facts.md §3):
 * which item kinds this capability is handed a record for, and which groups of
 * that record it reads. A capability is invoked only when every group it needs
 * was read, so it never sees `Unread` for one it declared — and a need no
 * producer its triggers name ever reads is refused here, because that
 * capability would be skipped on every delivery instead.
 */
export interface CapabilityDeclaration {
    readonly name: string;
    readonly triggers: readonly DeclaredTrigger[];
    readonly configKeys: readonly string[];
    readonly requiredMappings: DeclaredMappings;
    readonly facts: readonly string[];
    readonly needs: readonly string[];
    readonly resolvers: readonly string[];
    readonly intents: readonly string[];
    readonly operationalNeeds: OperationalNeeds;
}

/**
 * A declaration whose names are catalogue keys. `CapabilityDeclaration`
 * keeps `readonly string[]` so malformed external declarations remain
 * runtime-validatable; the runtime boundary needs key-constrained names.
 *
 * Narrowing `requiredMappings` here is also what makes a declaration usable
 * as `AdmittedCapability` without a cast — the shape `parseConfig` admits.
 */
export interface TypedDeclaration extends CapabilityDeclaration {
    readonly requiredMappings: RequiredMappings;
    readonly facts: readonly FactKind[];
    readonly needs: readonly FactGroup[];
    readonly resolvers: readonly ResolverName[];
    readonly intents: readonly IntentOperation[];
}

/**
 * Identity at runtime; the point is the `const` type parameter, which
 * pins `facts`, `needs`, `resolvers`, and `intents` as literal tuples. A
 * declaration written as a plain object widens them to `string[]`, and
 * every projection in `boundary.ts` then degrades to "any name" — losing
 * exactly the isolation the boundary exists to enforce. Declare capabilities
 * through this function, never by annotating them `: TypedDeclaration`.
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
 * Is the declaration structurally sound, judged without the catalogues? Pure;
 * returns every violation rather than the first, in the same errors-as-values
 * style as `parseConfig`.
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

    const lists: (readonly [string, readonly string[]])[] = [
        ["configKeys", d.configKeys],
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

    /**
     * A meaning nobody can map is a requirement nobody can satisfy: the
     * capability would be enabled-and-refused in every repository, and the
     * configuration error would name a meaning the file is forbidden to spell.
     */
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
    /**
     * facts.md §3: a need is satisfiable only if some declared kind carries the
     * group. `review` on an issue-only declaration is a capability the engine
     * could never invoke, refused once at boot rather than skipped in silence
     * on every record.
     */
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
 * Every need this producer leaves unread, as errors — the defect that made the
 * check necessary, in one sentence each.
 *
 * A need the waking producer never reads is not a capability that runs with
 * less. It is a capability that never runs: the engine records `factsUnread`
 * and skips, on every delivery, in silence. Finding it costs a build, and it
 * reads as a bug in the capability (the capability study of 2026-09-10,
 * defect 2).
 *
 * The message names all three things the fix needs — which trigger, which
 * group, and who does read it — because the repair is always either a
 * different trigger or one fewer need. A group with no reader at all cannot
 * arise: `producers.test.ts` holds every group to at least one producer.
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

/**
 * Is every declared need answered by the producer each trigger wakes?
 *
 * Per trigger, because both quantifiers are real: one capability may be woken
 * by a webhook and by a sweep, and each answers for its own deliveries. An
 * event no producer wakes on is the same defect one step earlier — nothing
 * ever delivers, so the capability is dead code whatever it needs.
 */
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

/**
 * Validate the complete direct capability set before any caller can use it.
 * Returns every structural, catalogue, and duplicate-name error.
 */
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
