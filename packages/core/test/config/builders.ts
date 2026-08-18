/**
 * A valid configuration, built rather than hand-rolled — the accepting half
 * of what `documents.ts` holds the rejections for.
 *
 * Four suites wrote the same `parseConfig` call: the same document literal,
 * the same throw on the failure arm, differing only in a revision string and
 * one `enabled` flag. Copies that similar drift rather than diverge — two of
 * them were byte-identical, which is a fact nobody could see from inside
 * either file.
 *
 * It sits beside the rejection corpus and not in the testkit because core
 * cannot depend on a package that depends on core; the testkit's own header
 * names config builders as the thing it will not take. Beside `documents.ts`
 * is also where Stryker can see it: the sandbox is the mutated package's own
 * directory, so in-package support is support that survives mutation (D82).
 */

import { parseConfig, type RepositoryConfig, type RepositoryMode } from "../../src/config/index.js";

/**
 * What a built configuration says beyond the empty document.
 *
 * Every field is optional and the defaults are the shape most tests want: an
 * `active` repository that has adopted nothing and maps nothing. `parseConfig`
 * defaults an ABSENT mode to `observe` (D56); this builder always states one,
 * so a test that omits `mode` gets a repository that acts.
 */
export interface ConfigOptions {
    readonly mode?: RepositoryMode;
    /** Meaning → label, spelt as a maintainer would write it in the file. */
    readonly labels?: Record<string, string>;
    /** The capability names the document declares, each with `enabled`. */
    readonly capabilities?: readonly string[];
    /** The consent every declared capability carries. Boolean, never truthy (§2.4). */
    readonly enabled?: boolean;
    /**
     * Per-capability settings, keyed by capability name. A name with no
     * entry declares an empty settings map, which is what the parser reads
     * for an absent one — so the tests whose subject is projection state
     * only the settings they are about.
     */
    readonly settings?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    /**
     * The application's admitted names. Defaults to `capabilities`, so a
     * declared capability is an admitted one; pass `[]` for the tests whose
     * subject is a repository naming something the App does not ship.
     */
    readonly known?: readonly string[];
    /** The revision the parser stamps onto the result and reports carry. */
    readonly revision?: string;
}

/**
 * Parse the described document, or throw with the codes that refused it.
 *
 * A test that reaches here wanted a configuration, so a rejection is a broken
 * test rather than an assertion — but it is the CODES that say which rule the
 * document tripped, and a bare "config must parse" makes the reader run the
 * parser in their head to find out (D75).
 */
export function configWith({
    mode = "active",
    labels = {},
    capabilities = [],
    enabled = true,
    settings = {},
    known = capabilities,
    revision = "rev-test",
}: ConfigOptions = {}): RepositoryConfig {
    const result = parseConfig(
        {
            schemaVersion: 1,
            mode,
            capabilities: Object.fromEntries(
                capabilities.map((name) => [name, { enabled, settings: settings[name] ?? {} }]),
            ),
            mappings: { labels },
        },
        { revision, knownCapabilities: known },
    );
    if (!result.ok) throw new Error(result.errors.map((e) => e.code).join(","));
    return result.config;
}

/**
 * One repository, adopting triage and mapping the one label it needs.
 *
 * The engine and the vertical slice want this exact document and differ only
 * where they must: the revision their reports carry, and — for the paths
 * where adoption is declared without consent — `enabled`. A test that needs
 * anything else from a configuration builds it with `configWith`.
 */
export function triageConfig(
    mode: RepositoryMode,
    revision: string,
    enabled = true,
): RepositoryConfig {
    return configWith({
        mode,
        enabled,
        revision,
        capabilities: ["triage"],
        labels: { awaitingTriage: "status: triage" },
    });
}
