/**
 * Which capabilities the platform knows about, and which of them may run.
 *
 * `declaration.ts` says what one declaration is and whether it is well
 * formed; this admits a set of them and answers lookups against it. The
 * names it holds feed `parseConfig({ knownCapabilities })`, which is why
 * retirement is a property of the registry rather than a deletion from it
 * (D23, experiments 6.3 and 6.5).
 */

import type { CapabilityDeclaration } from "./declaration.js";
import { checkAgainstCatalogue, validateDeclaration } from "./declaration.js";

/** What reporting may learn about a capability — never enough to run it. */
export interface CapabilityDescriptor {
    readonly name: string;
    readonly retired: boolean;
}

/** A declaration that is allowed to activate; the type cannot carry `retired: true`. */
export type ActiveCapabilityDeclaration = CapabilityDeclaration & {
    readonly retired?: false;
};

/**
 * The admitted set, with retirement enforced by the return types rather than
 * by callers remembering.
 *
 * The tombstone rule ("a retired capability's name stays valid but it never
 * activates") was documentation only: `activeNames` existed, nothing obliged
 * a caller to consult it, and `get` handed back a retired declaration ready
 * to run. Reporting now receives metadata only, and executable lookup is
 * fail-closed (FINDING(contract-retired-enforcement), D58).
 */
export interface CapabilityRegistry {
    /**
     * Every name ever shipped, retired included — the list
     * `parseConfig({ knownCapabilities })` consumes, so retirement
     * never invalidates a repository's configuration.
     */
    readonly names: readonly string[];
    /** Names that may actually activate — retired ones excluded. */
    readonly activeNames: readonly string[];
    /** Report-only metadata, retired included; omits triggers, intents and permissions. */
    describe(name: string): CapabilityDescriptor | undefined;
    /** The only declaration lookup: `undefined` for a retired or unknown name. */
    get(name: string): ActiveCapabilityDeclaration | undefined;
}

/** Fails closed like `parseConfig`: a registry or the reasons there is none. */
export type RegistryResult =
    | { readonly ok: true; readonly registry: CapabilityRegistry }
    | { readonly ok: false; readonly errors: readonly string[] };

/**
 * Build the platform's registry from its shipped declarations. Any invalid
 * declaration or duplicate name yields no registry at all — a platform must
 * not boot with a half-valid capability list.
 */
export function createRegistry(declarations: readonly CapabilityDeclaration[]): RegistryResult {
    const errors: string[] = declarations.flatMap((d) => [
        ...validateDeclaration(d),
        ...checkAgainstCatalogue(d),
    ]);
    const counts = new Map<string, number>();
    for (const d of declarations) counts.set(d.name, (counts.get(d.name) ?? 0) + 1);
    for (const [name, n] of counts) {
        if (n > 1) errors.push(`duplicate capability name "${name}" in the registry`);
    }
    if (errors.length > 0) return { ok: false, errors };

    const byName = new Map(declarations.map((d) => [d.name, d]));
    return {
        ok: true,
        registry: {
            names: declarations.map((d) => d.name),
            activeNames: declarations.filter((d) => d.retired !== true).map((d) => d.name),
            describe: (name) => {
                const found = byName.get(name);
                return found === undefined
                    ? undefined
                    : { name: found.name, retired: found.retired === true };
            },
            get: (name) => {
                const found = byName.get(name);
                return found?.retired === true
                    ? undefined
                    : (found as ActiveCapabilityDeclaration | undefined);
            },
        },
    };
}
