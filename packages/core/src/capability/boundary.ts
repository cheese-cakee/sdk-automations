/** How the platform CALLS a capability — `design/contracts/contract.md` §2 as types. */

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
import { readSettings, type SettingsOf, type SettingsView } from "./spec.js";

// ─── Typed projections ───────────────────────────────────────────────

/** One record with the declared groups read, the rest left `Unread` — facts.md §3. */
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
 * contract.md §2 — the projection a capability sees. No `mode`, no `enabled`,
 * no neighbour's block, and **no spellings**: names only (§2, P3).
 */
export interface CapabilityView<D extends TypedDeclaration> {
    /** This repository's answers to the capability's own spec, resolved. */
    readonly settings: SettingsOf<D["settings"]>;
    /** Which meanings the repository mapped, family by family. Names only. */
    readonly mapped: {
        readonly labels: readonly MappableMeaning[];
        readonly commands: readonly Command[];
        readonly skills: readonly Skill[];
        readonly alerts: readonly string[];
    };
    readonly principals: readonly string[];
}

/** A spec resolved against a file that named no block: its own defaults, or nothing. */
function defaultsOf(
    declaration: TypedDeclaration,
    view: SettingsView,
): Readonly<Record<string, unknown>> {
    const resolved = readSettings(declaration.settings, view, {});
    return resolved.ok ? resolved.value : {};
}

/**
 * Build that view. THE ONE CAST: the only producer of a `RepositoryConfig` is
 * `parseConfig`, which already read this block against this declaration's spec.
 */
export function projectCapabilityView<const D extends TypedDeclaration>(
    declaration: D,
    config: RepositoryConfig,
): CapabilityView<D> {
    const block = config.capabilities[declaration.name];
    // No `!== undefined` filter: `parseConfig` only assigns defined spellings.
    const view = {
        mapped: {
            labels: Object.keys(config.mappings.labels) as MappableMeaning[],
            commands: Object.keys(config.mappings.commands) as Command[],
            skills: Object.keys(config.mappings.skills) as Skill[],
            alerts: Object.keys(config.mappings.alerts),
        },
        principals: Object.keys(config.principals),
    };
    const resolved = block?.settings ?? defaultsOf(declaration, view);
    return { settings: resolved as CapabilityView<D>["settings"], ...view };
}

// ─── The handle and the capability ───────────────────────────────────

/** contract.md §2. No Octokit, HTTP, raw payload, or other capability reaches through. */
export interface PlatformHandle<D extends TypedDeclaration> {
    resolve<Q extends D["resolvers"][number] & ResolverName>(
        query: Q,
        input: ResolverInput<Q>,
    ): Promise<ResolverAnswer<ResolverOutput<Q>>>;
    explain(explanation: StructuredExplanation): void;
}

/**
 * A capability: its declaration, and the one function the platform calls.
 * `evaluate` never writes — everything it returns is a request policy may refuse.
 */
export interface Capability<D extends TypedDeclaration> {
    readonly declaration: D;
    evaluate(
        facts: FactsFor<D>,
        config: CapabilityView<D>,
        platform: PlatformHandle<D>,
    ): Promise<readonly IntentFor<D>[]>;
}
