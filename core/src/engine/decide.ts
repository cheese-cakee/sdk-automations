/**
 * decide() — the one verb (D92). A delivery or observation goes in; a
 * report and the approved intents come out; nothing else escapes.
 *
 * This file OWNS the composition that was previously hand-wired in four
 * places (the slice test, the scenario test, the probes harness, and the
 * shell-to-be): normalize → evaluate the enabled capabilities → screen
 * every intent → derive the safety context → gate every write → collect
 * every explanation. The wiring was the most duplicated un-owned thing in
 * the project, and the place its bugs lived.
 *
 * Externals are exactly the facts core cannot know — the kill switch, the
 * installation's grants, human-change ordering, resolver answers — supplied
 * as data and lookups, never I/O. Everything else the old API asked callers
 * to restate (`observedMeanings`, `preconditionHolds`) is now derived from
 * the observation by `preconditions.ts`, so a caller cannot assert a world
 * that contradicts the one it just delivered.
 */

import {
    projectCapabilityView,
    screenIntent,
    type AnyIntent,
    type ItemRef,
    type ObservationCatalogue,
    type RepositoryRef,
    type ResolverAnswer,
    type ResolverInput,
    type ResolverName,
    type ResolverOutput,
    type StructuredExplanation,
    type TypedDeclaration,
} from "../capability/index.js";
import { normalizeDelivery, type PermissionGrant } from "../github/index.js";
import type { RepositoryConfig } from "../config/index.js";
import { evaluateWrite } from "../safety/index.js";
import {
    explanationFinding,
    finding,
    screenFinding,
    verdictFinding,
    type Finding,
    type Report,
} from "../report/index.js";
import { expectedHolds, observedMeaningsOf } from "./preconditions.js";

export type EngineObservation = ObservationCatalogue[keyof ObservationCatalogue];

/** A capability with its type parameter erased — the probes-harness pattern. */
export interface EngineCapability {
    readonly declaration: TypedDeclaration;
    evaluate(
        observation: never,
        config: never,
        platform: never,
    ): Promise<readonly AnyIntent[]>;
}

export interface DecideExternals {
    readonly killSwitchActive: boolean;
    readonly installationGrants: readonly PermissionGrant[];
    /** Ordering evidence per item; `"unknown"` is a safe conflict (manual-edits.md §2). */
    readonly latestHumanChangeAt: (item: ItemRef) => Date | null | "unknown";
    /** Resolver answers, when the shell has them. Absent means unavailable. */
    readonly resolve?: <Q extends ResolverName>(
        query: Q,
        input: ResolverInput<Q>,
    ) => Promise<ResolverAnswer<ResolverOutput<Q>>>;
}

export type DecideInput =
    | {
          readonly kind: "delivery";
          /** The shell's routing knowledge — a report must name its repository even when the payload is unreadable. */
          readonly repository: RepositoryRef;
          readonly event: string;
          readonly payload: unknown;
      }
    | { readonly kind: "observation"; readonly observation: EngineObservation };

export interface Decision {
    readonly report: Report;
    /** Intents that passed every gate in `active` mode — what an executor may plan. */
    readonly approved: readonly AnyIntent[];
}

/**
 * The engine's platform handle: refuses undeclared resolvers WITHOUT
 * throwing (the engine is total), recording the violation for the report
 * instead — an undeclared resolver call is a capability defect, and a
 * defect deserves a problem finding, not a crash in the shell.
 */
class EngineHandle {
    readonly explanations: StructuredExplanation[] = [];
    readonly violations: string[] = [];

    constructor(
        private readonly declaration: TypedDeclaration,
        private readonly externals: DecideExternals,
    ) {}

    async resolve(query: ResolverName, input: unknown): Promise<ResolverAnswer<unknown>> {
        if (!this.declaration.resolvers.includes(query)) {
            this.violations.push(query);
            return {
                ok: false,
                reason: "notConfigured",
                detail: `"${this.declaration.name}" did not declare resolver "${query}"`,
            };
        }
        if (this.externals.resolve === undefined) {
            return { ok: false, reason: "unavailable", detail: "no resolver source supplied" };
        }
        return this.externals.resolve(query, input as never);
    }

    explain(explanation: StructuredExplanation): void {
        this.explanations.push(explanation);
    }
}

const projectionOf = (observation: EngineObservation) =>
    observation.kind === "staleItemsDue" ? null : observation.position;

export async function decide(
    input: DecideInput,
    config: RepositoryConfig,
    capabilities: readonly EngineCapability[],
    externals: DecideExternals,
): Promise<Decision> {
    const findings: Finding[] = [];
    const approved: AnyIntent[] = [];
    let repository: RepositoryRef;
    let observation: EngineObservation | null = null;

    if (input.kind === "delivery") {
        repository = input.repository;
        const normalized = normalizeDelivery(input.event, input.payload, config);
        if (normalized.kind === "ignored") {
            findings.push(
                finding(
                    "info",
                    "deliveryIgnored",
                    `event "${normalized.event}" carries no observation`,
                    { kind: "repository" },
                ),
            );
        } else if (normalized.kind === "malformed") {
            findings.push(
                finding("problem", normalized.code, normalized.detail, {
                    kind: "repository",
                }),
            );
        } else {
            observation = normalized.observation;
            repository = observation.repository;
        }
    } else {
        observation = input.observation;
        repository = observation.repository;
    }

    if (observation !== null) {
        const projection = projectionOf(observation);
        const observedMeanings =
            projection === null ? [] : observedMeaningsOf(projection);

        for (const capability of capabilities) {
            const declaration = capability.declaration;
            if (config.capabilities[declaration.name]?.enabled !== true) continue;
            if (!declaration.observations.includes(observation.kind)) continue;

            const handle = new EngineHandle(declaration, externals);
            const view = projectCapabilityView(declaration, config);
            const intents = await capability.evaluate(
                observation as never,
                view as never,
                handle as never,
            );

            for (const explanation of handle.explanations) {
                findings.push(
                    explanationFinding(explanation, {
                        kind: "capability",
                        capability: declaration.name,
                    }),
                );
            }
            for (const resolver of handle.violations) {
                findings.push(
                    finding(
                        "problem",
                        "undeclaredResolver",
                        `"${declaration.name}" asked for undeclared resolver "${resolver}"`,
                        { kind: "capability", capability: declaration.name },
                    ),
                );
            }

            for (const intent of intents) {
                const subject = {
                    kind: "item",
                    capability: declaration.name,
                    item: intent.item,
                } as const;
                const screen = screenIntent(intent, declaration);
                if (!screen.ok) {
                    findings.push(screenFinding(screen, subject));
                    continue;
                }
                /**
                 * The derivation, not an assertion. A projected observation
                 * yields the real check; an unprojected one (staleItemsDue)
                 * can honestly support only a vacuous claim — a capability
                 * claiming meaning-facts it was never shown is stale by
                 * construction.
                 */
                const preconditionHolds =
                    projection === null
                        ? intent.expected.meaningsPresent.length === 0 &&
                          intent.expected.meaningsAbsent.length === 0 &&
                          intent.expected.closed === null
                        : expectedHolds(intent.expected, projection);

                const declared = declaration.intents.find(
                    (i) => i.name === intent.operation,
                );
                const verdict = evaluateWrite(
                    {
                        capability: declaration.name,
                        actionClass: intent.actionClass,
                        requiredPermissions: declared?.requiredPermissions ?? [],
                        cause: intent.cause.cause,
                        causeObservedAt: intent.cause.observedAt,
                        target: {
                            item: `${intent.item.kind} #${intent.item.number}`,
                            change: intent.operation,
                        },
                    },
                    config,
                    {
                        killSwitchActive: externals.killSwitchActive,
                        installationGrants: externals.installationGrants,
                        observedMeanings,
                        preconditionHolds,
                        latestHumanChangeAt: externals.latestHumanChangeAt(intent.item),
                    },
                );
                /**
                 * An intent that ACTS (or would, in dry-run) tells its story:
                 * the explanation the factory made unskippable becomes the
                 * finding a managed comment and a dry-run report render.
                 * Refusals keep their refusal reasons unaccompanied — an
                 * explanation beside every refusal would drown the report
                 * (D92 3d, resolving the phase-1 design note).
                 */
                if (verdict.outcome !== "refuse") {
                    findings.push(explanationFinding(intent.explanation, subject));
                }
                findings.push(
                    verdictFinding(verdict, {
                        kind: "effect",
                        capability: declaration.name,
                        item: intent.item,
                        operation: intent.operation,
                    }),
                );
                if (verdict.outcome === "apply") approved.push(intent);
            }
        }
    }

    return {
        report: { revision: config.revision, mode: config.mode, repository, findings },
        approved,
    };
}
