/**
 * What remains of the probe world after D92 3(c): the engine owns the
 * platform wiring (`decide()` replaced `runEnabled`, and the engine matrix
 * replaced the harness matrix), so this file keeps only the test
 * conveniences that were never platform-shaped — a config builder, the
 * subset enumerator, and the observation union alias.
 */

import {
    parseConfig,
    type ObservationCatalogue,
    type RepositoryConfig,
} from "@hiero-hackers/automation-core";

export type AnyObservation = ObservationCatalogue[keyof ObservationCatalogue];

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
        { revision: "rev-1", knownCapabilities: known },
    );
    if (!result.ok) {
        throw new Error(`probe config invalid: ${result.errors.map((e) => e.message).join("; ")}`);
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
