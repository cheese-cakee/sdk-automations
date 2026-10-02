/**
 * The rehearsal's judgements: whether every delivery GitHub sent has been decided, and how an
 * issue or its decisions differ from what a step expected. Pure, so the live verdicts are tested.
 */

/** One delivery attempt as the repository hook's log lists it. A redelivery repeats the guid. */
export interface HookDelivery {
    readonly id: string;
    readonly guid: string;
    readonly event: string;
    readonly action: string | null;
    readonly statusCode: number;
}

/** One delivery as the shell's store holds it. */
export interface StoredDelivery {
    readonly id: string;
    readonly state: string;
}

/** One decision row about an item. */
export interface StoredDecision {
    readonly sourceId: string;
    readonly capability: string;
    readonly verdict: string;
    readonly code: string | null;
}

/** An issue as GitHub reads it back, in label names. */
export interface IssueState {
    readonly labels: readonly string[];
    readonly locked: boolean;
    readonly appComments: number;
    readonly appLabelWrites: number;
}

export type Settlement =
    | { readonly kind: "waiting" }
    | { readonly kind: "settled" }
    | { readonly kind: "failed"; readonly reason: string };

const WAITING: Settlement = { kind: "waiting" };

/** The receiver's answer to a delivery it accepted. */
const ACCEPTED = 202;

/**
 * Settled once GitHub has listed more than `before` attempts, the receiver accepted each one,
 * and the store finished every delivery GitHub listed. A stored delivery the hook's log does
 * not show yet means the log is behind, so it waits.
 */
export function settlementOf(
    hook: readonly HookDelivery[],
    stored: readonly StoredDelivery[],
    before: number,
): Settlement {
    const refused = hook.filter((delivery) => delivery.statusCode !== ACCEPTED);
    if (refused.length > 0) {
        const named = refused.map(
            (delivery) => `${delivery.guid} → ${String(delivery.statusCode)}`,
        );
        return { kind: "failed", reason: `the receiver did not accept ${named.join(", ")}` };
    }
    const failed = stored.filter((delivery) => delivery.state === "failed");
    if (failed.length > 0) {
        const named = failed.map((delivery) => delivery.id).join(", ");
        return { kind: "failed", reason: `the store failed ${named}` };
    }
    if (hook.length <= before) return WAITING;
    const listed = new Set(hook.map((delivery) => delivery.guid));
    const states = new Map(stored.map((delivery) => [delivery.id, delivery.state]));
    const allDone = [...listed].every((guid) => states.get(guid) === "done");
    const allListed = stored.every((delivery) => listed.has(delivery.id));
    return allDone && allListed ? { kind: "settled" } : WAITING;
}

/** Each way the observed issue differs from the expected one; empty when they agree. */
export function issueDifferences(expected: IssueState, observed: IssueState): string[] {
    const differences: string[] = [];
    const want = [...expected.labels].sort().join(", ");
    const found = [...observed.labels].sort().join(", ");
    if (want !== found) differences.push(`labels: expected [${want}], found [${found}]`);
    for (const key of ["locked", "appComments", "appLabelWrites"] as const) {
        if (expected[key] !== observed[key]) {
            differences.push(
                `${key}: expected ${String(expected[key])}, found ${String(observed[key])}`,
            );
        }
    }
    return differences;
}

/**
 * Each way one step's decisions fall short: an effect whose outcome is unknown, or a refusal
 * the step expected and no row carries. Empty when they satisfy the step.
 */
export function decisionDifferences(
    decisions: readonly StoredDecision[],
    refusals: readonly string[],
): string[] {
    const differences = decisions
        .filter((decision) => decision.verdict === "unknown")
        .map((decision) => `${decision.capability} left an effect unknown in ${decision.sourceId}`);
    const codes = new Set(decisions.map((decision) => decision.code));
    for (const code of refusals) {
        if (!codes.has(code)) differences.push(`expected a decision coded ${code}, found none`);
    }
    return differences;
}
