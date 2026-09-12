/**
 * One write operation's handler: the five things every operation's module
 * answers, down to the seams one send reaches GitHub through.
 *
 * `design/guides/write-operations.md` §3 is the contract; this file is that
 * contract in TypeScript. It sits above every module in this directory, so it
 * names no operation and imports none.
 *
 * The seams restate shapes the adapter already has. That is deliberate and
 * enforced: `.dependency-cruiser.cjs` admits the adapter at `main.ts` and
 * nowhere else, so the shell names what it needs and the composition root
 * passes the adapter's own objects, which satisfy it structurally.
 */

import type {
    Effect,
    Intent,
    IntentOperation,
    ItemRef,
    RepositoryConfig,
} from "@hiero-hackers/automation-core";
import { renderManagedBody, type Call, type Plan } from "../effects.js";

/** What one write turned out to be — the endpoint matrix's six words. */
export type WriteResult =
    | { readonly outcome: "applied" }
    | { readonly outcome: "already" }
    | { readonly outcome: "conflict"; readonly detail: string }
    | { readonly outcome: "forbidden"; readonly detail: string }
    | { readonly outcome: "retryLater"; readonly detail: string }
    | { readonly outcome: "unknown"; readonly detail: string };

/** The four confirmed write endpoints, and nothing else (D4). */
export interface EffectWriter {
    addLabel(item: ItemRef, label: string): Promise<WriteResult>;
    removeLabel(item: ItemRef, label: string): Promise<WriteResult>;
    createComment(item: ItemRef, body: string): Promise<WriteResult>;
    updateComment(commentId: number, body: string): Promise<WriteResult>;
}

/** A read that answered, or the reason it established nothing. */
export type ReadAnswer<T> =
    { readonly ok: true; readonly value: T } | { readonly ok: false; readonly detail: string };

/** D46's three answers; `unknown` is not a soft "absent". */
export type SeenState = "present" | "absent" | "unknown";

/** One comment, as the marker matcher needs it. */
export interface CommentSeen {
    readonly id: number;
    readonly body: string;
    readonly authoredByApp: boolean;
}

/** The item's own facts, as the apply-time re-gate rebuilds a projection from. */
export interface ItemSeen {
    readonly labels: readonly string[];
    readonly closed: boolean;
    readonly merged: boolean;
}

/** What GitHub says is there now. Presence answers on sight; absence obeys D46. */
export interface EffectReader {
    comments(item: ItemRef): Promise<ReadAnswer<readonly CommentSeen[]>>;
    labels(item: ItemRef): Promise<ReadAnswer<readonly string[]>>;
    item(item: ItemRef): Promise<ReadAnswer<ItemSeen>>;
    commentPresence(item: ItemRef, matches: (comment: CommentSeen) => boolean): Promise<SeenState>;
    labelPresence(item: ItemRef, label: string): Promise<SeenState>;
}

/** Whether a read-back says a call's postcondition holds. */
export type Confirmation = "held" | "notHeld" | "unknown";

/** A presence read as a confirmation; an unknown read stays unknown. */
export const held = (seen: SeenState, holds: SeenState): Confirmation =>
    seen === "unknown" ? "unknown" : seen === holds ? "held" : "notHeld";

/**
 * Which call verbs each operation owns.
 *
 * The split is spelled here rather than derived from the modules' `verbs`
 * arrays, because this file cannot see them. It is checked rather than
 * trusted: `CallOf` indexes this type by `IntentOperation`, so an operation
 * with no line fails to compile there, and a verb `Call` does not hold extracts
 * to `never` at the handler that claims it.
 */
interface OperationVerbs {
    readonly postManagedComment: "postComment";
    readonly applyMappedLabel: "addLabel" | "removeLabel";
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
    readonly writer: EffectWriter;
    readonly reader: EffectReader;
    /**
     * Is a comment the one THIS CALL would be? Authorship and marker, both
     * required (D125).
     *
     * The argument is the call's rendered body, because that is where the
     * identity is published and it is the whole of what a journal row carries
     * (D145). The applier owns the judgement; a handler only says which body
     * it is asking about.
     */
    isMine(body: string): (comment: CommentSeen) => boolean;
}

/**
 * One act's calls: the act itself, and — where the act carries grace — the
 * notice that says what the App did (grace.md §3).
 *
 * Two calls rather than one, in that order, because the applier's plan runs in
 * order and stops at the first refusal: a notice can therefore never claim an
 * act that did not land. The notice goes out under the ACT's managed identity
 * with kind `notice`, minted at approval alongside the act — so the comment a
 * resend recognises is found by the same name the act is journalled under.
 *
 * Written here rather than in each destructive handler because it is the same
 * two calls for every one of them, and this file is where the shape of a plan
 * already lives. A handler with no grace to honour gets its own call back
 * unchanged, so both destructive handlers call this unconditionally.
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
    /** The row fields after the head — `verb` first, then the call's own fields, in row order. */
    serialize(call: CallOf<K>): Record<string, unknown>;
    /** The call a row's bytes hold, or `null`; total over `unknown`. */
    parse(row: unknown): CallOf<K> | null;
    /** One call, sent; the read-before-write for a comment lives here. */
    send(call: CallOf<K>, pass: SendContext): Promise<WriteResult>;
    /** Does GitHub say this call's postcondition holds? */
    confirm(call: CallOf<K>, pass: SendContext): Promise<Confirmation>;
}
