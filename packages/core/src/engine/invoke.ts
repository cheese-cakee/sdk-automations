/**
 * How the engine calls a capability whose declaration type it cannot know: it
 * holds a heterogeneous list and so has no single `D`, and works against the
 * erased shapes here.
 */

import type {
    AnyIntent,
    Capability,
    ResolverAnswer,
    ResolverInput,
    ResolverName,
    ResolverOutput,
    StructuredExplanation,
    TypedDeclaration,
} from "../capability/index.js";
import { MAPPABLE_MEANINGS } from "../config/index.js";

function own(value: unknown, key: string): unknown {
    if (typeof value !== "object" || value === null) return undefined;
    return Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined;
}

function item(
    value: unknown,
): { readonly kind: "issue" | "pullRequest"; readonly number: number } | null {
    const kind = own(value, "kind");
    const number = own(value, "number");
    return (kind === "issue" || kind === "pullRequest") &&
        typeof number === "number" &&
        Number.isSafeInteger(number) &&
        number > 0
        ? { kind, number }
        : null;
}

/** One `ConfigError`, re-read: the four fields a report renders. */
function configError(value: unknown): unknown | null {
    const code = own(value, "code");
    const message = own(value, "message");
    const path = own(value, "path");
    const line = own(value, "line");
    if (typeof code !== "string" || typeof message !== "string") return null;
    if (path !== null && typeof path !== "string") return null;
    if (line !== undefined && (typeof line !== "number" || !Number.isSafeInteger(line)))
        return null;
    return line === undefined ? { code, message, path } : { code, message, path, line };
}

/**
 * `configAtHead`'s union, read to the depth a reader of it branches on. The
 * parsed `RepositoryConfig` is checked for being a mapping and no further (D77).
 */
function configAtHead(value: unknown): unknown | null {
    const touched = own(value, "touched");
    if (touched === false) return { touched: false };
    if (touched !== true) return null;

    const revision = own(value, "revision");
    const result = own(value, "result");
    const ok = own(result, "ok");
    if (typeof revision !== "string" || revision.length === 0) return null;

    if (ok === true) {
        const config = own(result, "config");
        return typeof config === "object" && config !== null
            ? { touched: true, revision, result: { ok: true, config } }
            : null;
    }
    if (ok !== false) return null;

    const errors = own(result, "errors");
    if (!Array.isArray(errors)) return null;
    const read = errors.map(configError);
    return read.every((error) => error !== null)
        ? { touched: true, revision, result: { ok: false, errors: read } }
        : null;
}

/** A list answer's entries, or `null` when the answer is not a list at all. */
function entriesOf(value: unknown): readonly unknown[] | null {
    return Array.isArray(value) ? [...(value as readonly unknown[])] : null;
}

/** `assigneesOf` — logins, as written. */
function assignees(value: unknown): unknown | null {
    const listed = entriesOf(value);
    if (listed === null) return null;
    return listed.every((entry) => typeof entry === "string") ? [...listed] : null;
}

/** `linkedIssues` — the items a pull request closes. */
function linked(value: unknown): unknown | null {
    const listed = entriesOf(value);
    if (listed === null) return null;
    const items = listed.map(item);
    return items.every((entry) => entry !== null) ? items : null;
}

/** `commitAttestations` — the five facts a quality check judges, per commit. */
function attestations(value: unknown): unknown | null {
    const listed = entriesOf(value);
    if (listed === null) return null;
    const commits = listed.map((entry) => {
        const sha = own(entry, "sha");
        const summary = own(entry, "summary");
        const signedOff = own(entry, "signedOff");
        const verified = own(entry, "verified");
        const merge = own(entry, "merge");
        return typeof sha === "string" &&
            typeof summary === "string" &&
            typeof signedOff === "boolean" &&
            typeof verified === "boolean" &&
            typeof merge === "boolean"
            ? { sha, summary, signedOff, verified, merge }
            : null;
    });
    return commits.every((entry) => entry !== null) ? commits : null;
}

/** `openAssignments` — each held item with the meanings it carries. */
function assignments(value: unknown): unknown | null {
    const listed = entriesOf(value);
    if (listed === null) return null;
    const held = listed.map((entry) => {
        const target = item(own(entry, "item"));
        const meanings = own(entry, "meanings");
        return target !== null &&
            Array.isArray(meanings) &&
            meanings.every(
                (meaning) =>
                    typeof meaning === "string" && MAPPABLE_MEANINGS.includes(meaning as never),
            )
            ? { item: target, meanings: [...meanings] }
            : null;
    });
    return held.every((entry) => entry !== null) ? held : null;
}

/** A resolver added to the catalogue needs a reader above, or this file does not build. */
function assertNever(_query: never): null {
    return null;
}

/** One resolver's answer value, re-read to the shape its catalogue entry promises. */
function answerValue(query: ResolverName, value: unknown): unknown | null {
    switch (query) {
        case "isAutomationActor":
        case "mergeability":
            return typeof value === "boolean" ? value : null;
        case "configAtHead":
            return configAtHead(value);
        case "assigneesOf":
            return assignees(value);
        case "linkedIssues":
            return linked(value);
        case "commitAttestations":
            return attestations(value);
        case "openAssignments":
            return assignments(value);
        default:
            return assertNever(query);
    }
}

function resolverAnswer(query: ResolverName, value: unknown): ResolverAnswer<unknown> | null {
    try {
        const ok = own(value, "ok");
        if (ok === true) {
            const answer = answerValue(query, own(value, "value"));
            return answer === null ? null : { ok: true, value: answer };
        }
        const reason = own(value, "reason");
        const detail = own(value, "detail");
        return ok === false &&
            ["noPermission", "rateLimited", "unavailable", "notConfigured"].includes(
                reason as string,
            ) &&
            typeof detail === "string"
            ? { ok: false, reason: reason as never, detail }
            : null;
    } catch {
        return null;
    }
}

/** A capability with its declaration type erased — what a list can hold. */
export interface EngineCapability {
    readonly declaration: TypedDeclaration;
    evaluate(facts: never, config: never, platform: never): Promise<readonly AnyIntent[]>;
}

/**
 * The one blessed erasure (D92), sound because `never` in every parameter
 * position is what any concrete `evaluate` accepts contravariantly.
 */
export function toEngine<D extends TypedDeclaration>(capability: Capability<D>): EngineCapability {
    return capability as unknown as EngineCapability;
}

/** Where resolver answers come from. A shell without one supplies nothing. */
export type ResolverSource = <Q extends ResolverName>(
    query: Q,
    input: ResolverInput<Q>,
) => Promise<ResolverAnswer<ResolverOutput<Q>>>;

/**
 * What a thrown value says, for a finding. Anything can be thrown, so the
 * non-`Error` case is normal rather than paranoid.
 */
export function thrownDetail(thrown: unknown): string {
    try {
        return thrown instanceof Error ? String(thrown.message) : String(thrown);
    } catch {
        return "an unprintable value";
    }
}

/**
 * The handle a capability is given: it refuses an undeclared resolver without
 * throwing, into `violations`; a throwing resolver source goes to `failures`.
 */
export class EngineHandle {
    readonly explanations: StructuredExplanation[] = [];
    readonly violations: string[] = [];
    /** Declared resolvers whose source threw, as `name: detail`. */
    readonly failures: string[] = [];

    constructor(
        private readonly declaration: TypedDeclaration,
        private readonly source: ResolverSource | undefined,
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
        if (this.source === undefined) {
            return { ok: false, reason: "unavailable", detail: "no resolver source supplied" };
        }
        try {
            const answer: unknown = await this.source(query, input as never);
            const read = resolverAnswer(query, answer);
            if (read !== null) return read;
            const detail = "the resolver source returned a malformed answer";
            this.failures.push(`${query}: ${detail}`);
            return { ok: false, reason: "unavailable", detail };
        } catch (thrown) {
            // `unavailable`, never an empty value: a source that threw established nothing.
            const detail = thrownDetail(thrown);
            this.failures.push(`${query}: ${detail}`);
            return { ok: false, reason: "unavailable", detail };
        }
    }

    explain(explanation: StructuredExplanation): void {
        this.explanations.push(explanation);
    }
}
