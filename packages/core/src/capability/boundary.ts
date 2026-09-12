/**
 * How the platform CALLS a capability — `design/contracts/contract.md` §2 as
 * types.
 *
 * `declaration.ts` says what a capability is; this says how it is invoked and
 * what it is allowed to see. The shape of what is ABSENT from `PlatformHandle`
 * is the guarantee: no Octokit, no HTTP, no raw payload, no other capability.
 */

import type { TypedDeclaration } from "./declaration.js";
import type { Command, MappableMeaning, RepositoryConfig, Skill } from "../config/index.js";
import type {
    Facts,
    FactGroup,
    ResolverAnswer,
    ResolverInput,
    ResolverName,
    ResolverOutput,
    StructuredExplanation,
    Unread,
} from "./catalogue.js";
import type { AnyIntent } from "./intent.js";

// ─── Typed projections ───────────────────────────────────────────────

/**
 * One record with the declared groups read, the rest left `Unread` — the view
 * half of contracts/facts.md §3, and the guarantee that makes the engine's
 * skip rule structural rather than a promise.
 *
 * `"unread"` cannot reach a capability that declared the group, because the
 * union member is removed. A group it did NOT declare is typed `Unread`, which
 * nothing can do anything with — so the declaration is the whole of what a
 * capability can read, not a description of it.
 */
type Read<F extends Facts, N extends FactGroup> = {
    readonly [K in keyof F]: K extends N
        ? Exclude<F[K], Unread>
        : K extends FactGroup
          ? Unread
          : F[K];
};

/** The fact union a declaration receives — one member per declared kind. */
export type FactsFor<D extends TypedDeclaration> = Read<
    Extract<Facts, { kind: D["facts"][number] }>,
    D["needs"][number]
>;

/** The intent union a declaration may return — one member per declared operation. */
export type IntentFor<D extends TypedDeclaration> = Extract<
    AnyIntent,
    { operation: D["intents"][number] }
>;

// ─── The view a capability sees ──────────────────────────────────────

/**
 * contract.md §2 — the projection a capability sees. Four deliberate
 * omissions, each of which would hand a capability a decision that is not
 * its own:
 *
 * - no `mode`: dry-run and active are policy. A capability that branched
 *   on mode would be deciding whether to write, which is rule 10's job.
 * - no `enabled`: a disabled capability is never evaluated (§4), so the
 *   field could only ever read `true` — and a capability that could read
 *   it could try to act while off.
 * - no other capability's block (§2, P3).
 * - **no spellings.** §2 says a capability receives internal
 *   meanings rather than repository label strings", so the view reports
 *   WHICH meanings a repository has mapped in each family, never what it
 *   calls them. Passing `mappings` through would have satisfied the types and
 *   quietly broken the rule; a capability that never sees a label or a command
 *   word cannot hard-code one.
 *
 * `principals` is names only, and is not a fifth omission for the same reason
 * `mapped` is not: a settings value that names a principal has to be
 * checkable against the ones the document declares, or a subscription pointing
 * at a team nobody declared would be silently ignored instead of reported. The
 * NAME is the repository's own word for a role; the team string behind it is
 * the adapter's business, exactly as a label string is.
 */
export interface CapabilityView<D extends TypedDeclaration> {
    readonly settings: {
        readonly [K in D["configKeys"][number]]?: unknown;
    };
    /**
     * Which meanings the repository mapped, family by family. Names only.
     *
     * `alerts` and `types` are the open-keyed families, so their names are the
     * repository's own words rather than a platform union — but they arrive
     * here for exactly the reason the closed families do: a settings value
     * naming one must be checkable against the ones the file maps, or a
     * subscription to an alert nobody spelled is silently ignored instead of
     * reported.
     */
    readonly mapped: {
        readonly labels: readonly MappableMeaning[];
        readonly commands: readonly Command[];
        readonly skills: readonly Skill[];
        readonly alerts: readonly string[];
        readonly types: readonly string[];
    };
    readonly principals: readonly string[];
}

/**
 * Build that view. Undeclared settings keys are dropped rather than
 * rejected — the capability's own schema owns its block (§2), and this
 * function's job is the isolation cut, not validation.
 *
 * Since D84 `parseConfig` rejects an undeclared settings key outright, so for
 * a parsed configuration the drop below never fires. It stays as the
 * boundary's own defense: this function takes a `RepositoryConfig`, not a
 * promise about where one came from, and the isolation cut must hold for
 * `NO_CONFIG` and for any caller that builds one another way.
 */
export function projectCapabilityView<const D extends TypedDeclaration>(
    declaration: D,
    config: RepositoryConfig,
): CapabilityView<D> {
    const block = config.capabilities[declaration.name];
    const settings: Record<string, unknown> = Object.create(null);
    for (const key of declaration.configKeys) {
        if (block !== undefined && Object.hasOwn(block.settings, key)) {
            settings[key] = block.settings[key];
        }
    }
    // No `!== undefined` filter on the meanings: under
    // `exactOptionalPropertyTypes` a present key on
    // `Partial<Record<MappableMeaning, string>>` holds a string, and
    // `parseConfig` only ever assigns defined spellings, so it was unreachable.
    return {
        settings: settings as CapabilityView<D>["settings"],
        mapped: {
            labels: Object.keys(config.mappings.labels) as MappableMeaning[],
            commands: Object.keys(config.mappings.commands) as Command[],
            skills: Object.keys(config.mappings.skills) as Skill[],
            alerts: Object.keys(config.mappings.alerts),
            types: Object.keys(config.mappings.types),
        },
        principals: Object.keys(config.principals),
    };
}

// ─── The handle and the capability ───────────────────────────────────

/**
 * contract.md §2. `Q extends D["resolvers"][number]` is the isolation
 * rule as a type: an undeclared resolver does not compile. It does not
 * expose Octokit, HTTP, a raw payload, arbitrary comments, or another
 * capability — the shape of what is absent is the guarantee.
 */
export interface PlatformHandle<D extends TypedDeclaration> {
    resolve<Q extends D["resolvers"][number] & ResolverName>(
        query: Q,
        input: ResolverInput<Q>,
    ): Promise<ResolverAnswer<ResolverOutput<Q>>>;
    explain(explanation: StructuredExplanation): void;
}

/**
 * A capability: its declaration, and the one function the platform calls.
 *
 * `evaluate` is pure with respect to the repository — a capability decides,
 * it never writes. Everything it returns is a REQUEST the policy layer may
 * refuse, which is why it cannot report success or receive an effect result.
 */
export interface Capability<D extends TypedDeclaration> {
    readonly declaration: D;
    evaluate(
        facts: FactsFor<D>,
        config: CapabilityView<D>,
        platform: PlatformHandle<D>,
    ): Promise<readonly IntentFor<D>[]>;
}
