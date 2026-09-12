/**
 * How the engine calls a capability whose declaration type it cannot know.
 *
 * `capability/boundary.ts` is the typed side: `Capability<D>` and
 * `PlatformHandle<D>` say what one capability sees, with its declaration as
 * the type parameter. The engine holds a heterogeneous LIST and so has no
 * single `D` — it works against the erased shapes here, and `decide.ts`
 * composes them without restating the erasure at every call.
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

function answerValue(query: ResolverName, value: unknown): unknown | null {
    if (query === "isAutomationActor" || query === "mergeability") {
        return typeof value === "boolean" ? value : null;
    }
    if (!Array.isArray(value)) return null;
    const entries = [...value];
    if (query === "assigneesOf") {
        return entries.every((entry) => typeof entry === "string") ? entries : null;
    }
    if (query === "linkedIssues") {
        const items = entries.map(item);
        return items.every((entry) => entry !== null) ? items : null;
    }
    if (query === "commitAttestations") {
        const commits = entries.map((entry) => {
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
    const assignments = entries.map((entry) => {
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
    return assignments.every((entry) => entry !== null) ? assignments : null;
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
 * The one blessed erasure (D92). Sound because `never` in every parameter
 * position is what any concrete `evaluate` accepts contravariantly: nothing
 * widens, and the capability gains no reach it did not have. The argument
 * lives here once so that no call site has to make it again.
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
 * The handle a capability is given: it refuses an undeclared resolver
 * WITHOUT throwing, recording the violation instead. The engine is total,
 * and an undeclared resolver call is a capability defect — a defect deserves
 * a problem finding, not a crash in the shell.
 *
 * A resolver SOURCE that throws is contained the same way, and the two are
 * recorded separately because they blame different people: `violations` is
 * the capability's defect, `failures` the shell's.
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
            // `unavailable`, never an empty value: "unknown is not an answer"
            // (`design/contracts/catalogue.md`) forbids a capability reading a
            // broken lookup as a negative answer, and a source that threw
            // established nothing at all.
            const detail = thrownDetail(thrown);
            this.failures.push(`${query}: ${detail}`);
            return { ok: false, reason: "unavailable", detail };
        }
    }

    explain(explanation: StructuredExplanation): void {
        this.explanations.push(explanation);
    }
}
