/**
 * The probe world: a fake platform shell, just enough of one to call
 * capabilities the way the real shell will.
 *
 * `runEnabled` is the registry-activation step from build-plan §8 item 4
 * ("the registry activates only explicitly enabled capabilities") written
 * as the smallest thing that could work. It lives in `test/` rather than
 * `src/` deliberately: it is the measuring instrument, not the platform.
 */

import {
    parseConfig,
    projectCapabilityView,
    type AnyIntent,
    type Capability,
    type ObservationCatalogue,
    type PlatformHandle,
    type RepositoryConfig,
    type ResolverAnswer,
    type ResolverName,
    type StructuredExplanation,
    type TypedDeclaration,
} from "@hiero-hackers/automation-core";

export type AnyObservation = ObservationCatalogue[keyof ObservationCatalogue];

/**
 * A capability with its type parameter erased, so a heterogeneous list of
 * them can be iterated. `never` in the parameter positions is what makes
 * the erasure sound: any concrete `evaluate` accepts it contravariantly,
 * so nothing is widened and no capability gains reach it did not have.
 */
export type ProbeCapability = {
    readonly declaration: TypedDeclaration;
    evaluate(
        observation: never,
        config: never,
        platform: never,
    ): Promise<readonly AnyIntent[]>;
};

/** What the fake resolvers answer, per capability run. */
export interface ResolverScript {
    readonly linkedIssues?: ResolverAnswer<readonly { kind: "issue" | "pullRequest"; number: number }[]>;
    readonly isAutomationActor?: ResolverAnswer<boolean>;
}

export interface RunRecord {
    readonly capability: string;
    readonly observation: AnyObservation["kind"];
    readonly intents: readonly AnyIntent[];
    readonly explanations: readonly StructuredExplanation[];
    /** Every resolver a capability actually asked for, in order. */
    readonly resolverCalls: readonly string[];
}

class ProbeHandle<D extends TypedDeclaration> implements PlatformHandle<D> {
    readonly explanations: StructuredExplanation[] = [];
    readonly resolverCalls: string[] = [];

    constructor(
        private readonly declaration: D,
        private readonly script: ResolverScript,
    ) {}

    async resolve<Q extends D["resolvers"][number] & ResolverName>(
        query: Q,
        _input: unknown,
    ): Promise<ResolverAnswer<never>> {
        /**
         * The runtime half of the isolation rule. The type parameter
         * already rejects an undeclared resolver at compile time; a
         * capability reaching this branch was built from `unknown` or
         * compiled separately, and the handle must still refuse.
         */
        if (!this.declaration.resolvers.includes(query)) {
            throw new Error(
                `capability "${this.declaration.name}" asked for undeclared resolver "${query}"`,
            );
        }
        this.resolverCalls.push(query);
        const answer = this.script[query as keyof ResolverScript];
        if (answer === undefined) {
            return {
                ok: false,
                reason: "unavailable",
                detail: `the probe script gave no answer for "${query}"`,
            };
        }
        return answer as ResolverAnswer<never>;
    }

    explain(explanation: StructuredExplanation): void {
        this.explanations.push(explanation);
    }
}

/**
 * Evaluate every enabled capability that declares this observation.
 *
 * The two isolation properties the toggle matrix rests on are structural
 * here, not asserted afterwards: a capability is reached only through its
 * own projected view, and the capabilities array is iterated without any
 * capability being able to see it.
 */
export async function runEnabled(
    capabilities: readonly ProbeCapability[],
    config: RepositoryConfig,
    observation: AnyObservation,
    script: ResolverScript = {},
): Promise<readonly RunRecord[]> {
    const records: RunRecord[] = [];
    for (const capability of capabilities) {
        const declaration = capability.declaration;
        if (config.capabilities[declaration.name]?.enabled !== true) continue;
        if (!declaration.observations.includes(observation.kind)) continue;

        const handle = new ProbeHandle(declaration, script);
        const view = projectCapabilityView(declaration, config);
        const intents = await capability.evaluate(
            observation as never,
            view as never,
            handle as never,
        );

        records.push({
            capability: declaration.name,
            observation: observation.kind,
            intents: intents as readonly AnyIntent[],
            explanations: [...handle.explanations],
            resolverCalls: [...handle.resolverCalls],
        });
    }
    return records;
}

/** A repository configuration enabling exactly the named capabilities. */
export function configEnabling(
    names: readonly string[],
    known: readonly string[],
    extra: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {},
): RepositoryConfig {
    const capabilities: Record<string, unknown> = {};
    for (const name of known) {
        capabilities[name] = {
            enabled: names.includes(name),
            settings: extra[name] ?? {},
        };
    }
    const result = parseConfig(
        {
            schemaVersion: 1,
            mode: "active",
            capabilities,
            mappings: {
                labels: {
                    awaitingTriage: "status: triage",
                    inProgress: "status: in progress",
                    blocked: "blocked",
                },
            },
            principals: {},
        },
        { knownCapabilities: known },
    );
    if (!result.ok) {
        throw new Error(`probe config invalid: ${result.errors.join("; ")}`);
    }
    return result.config;
}

/** Every subset of the given names, smallest first. */
export function subsets<T>(items: readonly T[]): readonly (readonly T[])[] {
    const out: T[][] = [[]];
    for (const item of items) {
        for (const existing of [...out]) out.push([...existing, item]);
    }
    return out.sort((a, b) => a.length - b.length);
}
