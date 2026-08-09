/**
 * What a capability declares about itself, and whether the declaration holds
 * up — `design/modules/contract.md` §1 as validated types.
 *
 * The shape first, then the two validators that judge it: one structural, one
 * against the platform catalogues. `registry.ts` is the list of declarations
 * the platform ships; `boundary.ts` is how one of them is invoked.
 */

import { CAPABILITY_NAME_PATTERN } from "../config/schema.js";
import type { PermissionGrant } from "../github/index.js";
import { isPermissionGrant } from "../github/index.js";
import type {
    IdempotencyClass,
    IntentOperation,
    ObservationName,
    ResolverName,
} from "./catalogue.js";
import {
    INTENT_OPERATIONS,
    OBSERVATION_NAMES,
    RESOLVER_NAMES,
} from "./catalogue.js";

/** contract.md §1 triggers, split into the two real shapes. */
export type Trigger =
    | { readonly kind: "event"; readonly event: string }
    | { readonly kind: "schedule"; readonly description: string };

/** One intent a capability claims, with the facts it must restate correctly (D23). */
export interface IntentDeclaration {
    readonly name: string;
    readonly idempotencyClass: IdempotencyClass;
    /** Repository permissions this intent's effects require. */
    readonly requiredPermissions: readonly PermissionGrant[];
}

/** What a capability needs from the platform to run at all — contract.md §1. */
export interface OperationalNeeds {
    readonly schedule: boolean;
    readonly durableState: "none" | "candidate" | "required";
    readonly crossItemCoordination: boolean;
    readonly externalDelivery: boolean;
}

/**
 * A capability's self-description — contract.md §1, with intents upgraded
 * from names to declarations.
 *
 * `retired` is a tombstone. A retired capability's name stays in the registry
 * forever: configs that enable it remain valid, but the capability never
 * activates and the effective-config report says so. Only names that never
 * existed are validation errors. Retirement is not allowed to be a breaking
 * change, and deleting a name — the only way to make it one — is not
 * representable.
 */
export interface CapabilityDeclaration {
    readonly name: string;
    readonly retired?: boolean;
    readonly triggers: readonly Trigger[];
    readonly configKeys: readonly string[];
    readonly observations: readonly string[];
    readonly resolvers: readonly string[];
    readonly intents: readonly IntentDeclaration[];
    readonly permissions: {
        readonly repository: readonly PermissionGrant[];
        readonly organization: readonly PermissionGrant[];
    };
    readonly operationalNeeds: OperationalNeeds;
}

/**
 * A declaration whose names are catalogue keys. `CapabilityDeclaration`
 * keeps `readonly string[]` because configuration validation and operator
 * reporting only need names; the runtime boundary needs the payload types
 * those names stand for, which only a key-constrained declaration gives.
 */
export interface TypedDeclaration extends CapabilityDeclaration {
    readonly observations: readonly ObservationName[];
    readonly resolvers: readonly ResolverName[];
    readonly intents: readonly (IntentDeclaration & {
        readonly name: IntentOperation;
    })[];
}

/**
 * Identity at runtime; the point is the `const` type parameter, which
 * pins `observations`, `resolvers`, and `intents` as literal tuples. A
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
export function validateDeclaration(d: CapabilityDeclaration): readonly string[] {
    const errors: string[] = [];
    const at = `capability "${d.name}"`;

    if (!CAPABILITY_NAME_PATTERN.test(d.name)) {
        errors.push(`declaration name ${JSON.stringify(d.name)} must be a camelCase configuration key`);
    }
    if (d.triggers.length === 0) {
        errors.push(`${at}: at least one trigger (event or schedule) is required — an untriggerable capability is dead code`);
    }
    if (d.triggers.some((t) => t.kind === "schedule") && !d.operationalNeeds.schedule) {
        errors.push(`${at}: declares a schedule trigger but operationalNeeds.schedule is false`);
    }

    for (const list of [
        ["configKeys", d.configKeys],
        ["observations", d.observations],
        ["resolvers", d.resolvers],
        ["intents", d.intents.map((i) => i.name)],
    ] as const) {
        for (const dup of duplicates(list[1])) {
            errors.push(`${at}: duplicate ${list[0]} entry "${dup}"`);
        }
    }

    // The declared set is repository AND organization grants (D57). Repository
    // only rejected an intent whose grant was legitimately declared under
    // `organization`, which would have blocked every org-scoped capability
    // (FINDING(contract-intent-org-permissions)).
    const declared = new Set<string>([
        ...d.permissions.repository,
        ...d.permissions.organization,
    ]);
    for (const grant of [...d.permissions.repository, ...d.permissions.organization]) {
        if (!isPermissionGrant(grant)) {
            errors.push(`${at}: permission "${grant}" is not in scope:level form`);
        }
    }
    for (const intent of d.intents) {
        for (const grant of intent.requiredPermissions) {
            if (!declared.has(grant)) {
                errors.push(
                    `${at}: intent "${intent.name}" requires "${grant}" which the capability does not declare — ` +
                    `an intent cannot exceed its capability's permissions`,
                );
            }
        }
    }

    return errors;
}

function isIntentOperation(name: string): name is IntentOperation {
    return Object.hasOwn(INTENT_OPERATIONS, name);
}

/**
 * Do the declared names exist, and does the declaration restate the
 * operation-owned facts correctly? Exported for focused diagnostics;
 * `createRegistry` is the trusted operation that always combines this with
 * structural validation.
 */
export function checkAgainstCatalogue(
    declaration: CapabilityDeclaration,
): readonly string[] {
    const errors: string[] = [];
    const at = `capability "${declaration.name}"`;

    for (const observation of declaration.observations) {
        if (!OBSERVATION_NAMES.some((name) => name === observation)) {
            errors.push(
                `${at}: observation "${observation}" is not in the observation catalogue`,
            );
        }
    }
    for (const resolver of declaration.resolvers) {
        if (!RESOLVER_NAMES.some((name) => name === resolver)) {
            errors.push(
                `${at}: resolver "${resolver}" is not in the resolver catalogue`,
            );
        }
    }
    for (const intent of declaration.intents) {
        if (!isIntentOperation(intent.name)) {
            errors.push(
                `${at}: intent "${intent.name}" is not in the operation catalogue`,
            );
            continue;
        }
        const facts = INTENT_OPERATIONS[intent.name];
        if (facts.idempotencyClass !== intent.idempotencyClass) {
            errors.push(
                `${at}: intent "${intent.name}" declares idempotencyClass "${intent.idempotencyClass}" but the operation is "${facts.idempotencyClass}" — ` +
                    `the platform owns this fact (FINDING(runtime-idempotency-declared-not-checked))`,
            );
        }
        if (!intent.requiredPermissions.includes(facts.permission)) {
            errors.push(
                `${at}: intent "${intent.name}" must require "${facts.permission}"`,
            );
        }
    }
    return errors;
}
