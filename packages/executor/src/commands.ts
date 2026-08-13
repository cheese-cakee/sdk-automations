/**
 * The adapter boundary: what crosses into an effect adapter, and through
 * what. Plain immutable data plus the one interface an adapter implements.
 *
 * Vocabulary only, and deliberately ignorant of everything on either side.
 * `planner.ts` builds these values out of approved intents; `recovery.ts`
 * journals and drives them. Neither concern belongs here, and an adapter
 * needs no other file in this package.
 */

import type {
    IdempotencyClass,
    ItemRef,
    MappableMeaning,
    RepositoryRef,
} from "@hiero-hackers/automation-core";

export interface ExpectedAdapterState {
    readonly meaningsPresent: readonly MappableMeaning[];
    readonly meaningsAbsent: readonly MappableMeaning[];
    readonly closed: boolean | null;
}

export interface ConfiguredLabel {
    readonly meaning: MappableMeaning;
    readonly label: string;
}

interface AdapterCommandBase {
    readonly repository: RepositoryRef;
    readonly item: ItemRef;
    /** The reviewed configuration revision that authorized this command. */
    readonly configurationRevision: string;
    readonly expected: ExpectedAdapterState;
    /** Ordered by the platform catalogue, so an adapter need not load configuration. */
    readonly configuredLabels: readonly ConfiguredLabel[];
}

export interface PostManagedCommentCommand extends AdapterCommandBase {
    readonly operation: "postManagedComment";
    readonly desired: {
        readonly marker: string;
        readonly body: string;
    };
    readonly readBack: {
        readonly kind: "managedCommentMarker";
    };
}

export interface ApplyMappedLabelCommand extends AdapterCommandBase {
    readonly operation: "applyMappedLabel";
    readonly desired: {
        readonly meaning: MappableMeaning;
        readonly label: string;
    };
    readonly readBack: {
        readonly kind: "mappedLabel";
    };
}

export interface UnassignCommand extends AdapterCommandBase {
    readonly operation: "unassign";
    readonly desired: {
        readonly login: string;
    };
    readonly readBack: {
        readonly kind: "assigneeAbsent";
    };
}

/** Plain immutable data: the only values crossing into an effect adapter. */
export type AdapterCommand = PostManagedCommentCommand | ApplyMappedLabelCommand | UnassignCommand;

export interface PlannedCall {
    /** 1-based, contiguous — the journal's call_seq. */
    readonly seq: number;
    readonly command: AdapterCommand;
    readonly idempotencyClass: IdempotencyClass;
}

export interface EffectPlan {
    readonly effectId: string;
    /** Immutable default-branch configuration revision/effective hash. */
    readonly revision: string;
    readonly calls: readonly PlannedCall[];
}

/**
 * The engine's only exits to the world. `perform` may throw — a throw
 * models the process dying mid-call (response lost); the engine never
 * catches it, exactly as a real crash never lets it. `readBack` is the
 * resolver: did this call's effect land? It must answer from GitHub
 * state (for non-idempotent calls, the managed-comment marker — D13).
 *
 * The loop's exactly-once guarantee is proven only relative to a
 * CONSISTENT read-back (D46). A stale "absent" right after a landed write
 * makes the loop duplicate despite following every rule, and real GitHub
 * reads can lag writes. The freshness rule an implementation owes is
 * `policy.ts`'s: answer "present" on first sight, "absent" only after
 * `READBACK_ABSENT_READS` reads spaced by
 * `READBACK_CONFIRM_ABSENT_DELAY_MS`.
 * FINDING(executor-readback-consistency).
 */
export interface EffectPort {
    perform(plan: EffectPlan, call: PlannedCall): Promise<void>;
    readBack(plan: EffectPlan, call: PlannedCall): Promise<"present" | "absent">;
}
