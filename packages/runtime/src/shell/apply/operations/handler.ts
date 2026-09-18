/** One write operation's handler, in TypeScript: write-operations.md §3 is the contract. */

import type {
    Allowance,
    CommentFact,
    Effect,
    Intent,
    IntentOperation,
    ItemRef,
    Presence,
    ReadBack,
    RepositoryConfig,
    WriteResult,
    WriteVerbs,
} from "@hiero-hackers/automation-core";
import { renderManagedBody, type Call, type Plan } from "../../effects.js";

/** Whether a read-back says a call's postcondition holds. */
export type Confirmation = "held" | "notHeld" | "unknown";

/** A presence read as a confirmation; an unknown read stays unknown. */
export const held = (seen: Presence, holds: Presence): Confirmation =>
    seen === "unknown" ? "unknown" : seen === holds ? "held" : "notHeld";

/**
 * Which call verbs each operation owns.
 * Checked, not trusted: `CallOf` indexes this by `IntentOperation`, so a missing line fails to compile there and a verb `Call` lacks extracts to `never`.
 */
interface OperationVerbs {
    readonly postManagedComment: "postComment";
    readonly applyMappedLabel: "defineLabel" | "addLabel" | "removeLabel";
    readonly assign: "assign";
    readonly unassign: "unassign";
    readonly releaseAssignment: "releaseAssignment";
    readonly closePullRequest: "closePullRequest";
    readonly lockIssue: "lockIssue";
    readonly unlockIssue: "unlockIssue";
}

/** The `Call` members one operation's handler owns. */
export type CallOf<K extends IntentOperation> = Extract<Call, { verb: OperationVerbs[K] }>;

/** What one send may know: the item, the two seams, and this effect's own identity. */
export interface SendContext {
    readonly item: ItemRef;
    readonly writer: WriteVerbs;
    readonly reader: ReadBack;
    readonly allowance: Allowance | undefined;
    /** Is a comment the one THIS CALL would be? Authorship and marker, both required (D125). */
    isMine(body: string): (comment: CommentFact) => boolean;
}

/**
 * One act's calls: the act, and where it carries grace the notice that says what the
 * App did (grace.md §3). Two calls in that order, because the plan stops at the first refusal — so a notice can never claim an act that did not land.
 */
export function planWithNotice(effect: Effect, act: Call): Plan {
    const grace = effect.intent.grace;
    if (grace === null) return { ok: true, calls: [act] };
    if (effect.managedComment === null) {
        return {
            ok: false,
            code: "identityMissing",
            detail: "the approved act carries no managed-comment identity to post its outcome notice under",
        };
    }
    return {
        ok: true,
        calls: [
            act,
            {
                verb: "postComment",
                kind: "notice",
                body: renderManagedBody(effect.managedComment.marker, grace.notice.body),
            },
        ],
    };
}

export interface OperationHandler<K extends IntentOperation> {
    /** The call verbs this operation's rows carry — `operationOf` is derived from these. */
    readonly verbs: readonly Call["verb"][];
    /** The calls one approved effect takes, in send order, or the reason it takes none. */
    plan(effect: Effect & { intent: Intent<K> }, config: RepositoryConfig): Plan;
    /** The row fields after the head — `verb` first, then the call's own, in row order. */
    serialize(call: CallOf<K>): Record<string, unknown>;
    /** The call a row's bytes hold, or `null`; total over `unknown`. */
    parse(row: unknown): CallOf<K> | null;
    /** One call, sent; the read-before-write for a comment lives here. */
    send(call: CallOf<K>, pass: SendContext): Promise<WriteResult>;
    /** Does GitHub say this call's postcondition holds? */
    confirm(call: CallOf<K>, pass: SendContext): Promise<Confirmation>;
}
