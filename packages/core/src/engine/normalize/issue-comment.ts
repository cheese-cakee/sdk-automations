/**
 * The issue-comment family: what an `issue_comment` delivery becomes once the
 * shared preamble has read it.
 *
 * One family, one module, one registry entry — `../events.ts` names this one
 * under `issue_comment` and hands it `DeliveryFacts`. It is the only family
 * that reads a SIBLING of the item: the command a contributor typed sits on
 * `comment`, while the item it is about sits on `issue`.
 *
 * The record it produces is an ORDINARY ISSUE record. A command is not an item
 * — it has no number, no position and no world to derive — so it is a fact
 * GROUP about the issue the comment sits on, projected through
 * `mappings.commands` exactly as labels are projected through
 * `mappings.labels`. A capability therefore reads `assign`, never `/assign`.
 *
 * Two readings this family makes and no other does.
 *
 * A COMMENT ON A PULL REQUEST IS CONSUMED AND UNREADABLE, not `ignored`.
 * GitHub delivers pull-request conversation as `issue_comment` with
 * `issue.pull_request` present, and the payload carries no `merged` — so no
 * honest `PullRequestFacts` can be built from it, because closure is exactly
 * what `merged` decides (D47). `ignored` would be the wrong word: `ignored` is
 * the system working on traffic that is not workflow traffic, and this IS
 * workflow traffic on an event we consume, arriving in a shape we cannot read.
 *
 * ONLY `created` CARRIES A COMMAND. An edited comment is a delivery we DID
 * read, which found no command issued — so `command` is `null`, a read group
 * with nothing in it, not `UNREAD`. That is what makes "an edit adds /assign
 * to an old comment" a fact rather than an absence of evidence.
 *
 * Every other group is `UNREAD`, and the `satisfies` below is that promise as
 * a constraint: the `issue_comment` row of `PRODUCERS` names `command` and
 * nothing else, so filling any other group here does not compile.
 */

import { UNREAD, type CommandFacts, type ProducedFacts } from "../../capability/index.js";
import { commandInComment } from "../../config/index.js";
import { projectIssue, type ClosureReason } from "../../workflow/index.js";
import { isRecord, timestamp, type DeliveryFacts } from "./payload.js";
import { malformed, type NormalizeResult } from "./verdict.js";

/** Issue closure, from what this payload alone can see — `issues.ts`'s reading. */
function issueClosure(item: Record<string, unknown>): ClosureReason | null {
    return item["state"] === "closed" ? "closedByHuman" : null;
}

/** What the comment readably says, or `null` when its shape is not GitHub's. */
function commentOf(
    facts: DeliveryFacts,
): { readonly body: string; readonly by: string; readonly at: Date } | null {
    const comment = facts.payload["comment"];
    if (!isRecord(comment)) return null;
    const user = comment["user"];
    const at = timestamp(comment["created_at"]);
    if (typeof comment["body"] !== "string" || !isRecord(user) || at === null) return null;
    if (typeof user["login"] !== "string" || user["login"] === "") return null;
    return { body: comment["body"], by: user["login"], at };
}

/**
 * The command this delivery issued, or `null` for a delivery that issued none.
 *
 * Takes the comment already read rather than reading it again: the refusal for
 * an unreadable one is the family's, made once, and a second reading here could
 * only ever disagree with it.
 */
function commandIssued(
    facts: DeliveryFacts,
    comment: { readonly body: string; readonly by: string; readonly at: Date },
): CommandFacts | null {
    if (facts.payload["action"] !== "created") return null;
    const command = commandInComment(facts.config, comment.body);
    return command === null ? null : { command, by: comment.by, at: comment.at };
}

/** The `issue_comment` entry of the registry. */
export const issueCommentNormalizer = {
    event: "issue_comment",
    itemKey: "issue",
    normalize(facts: DeliveryFacts): NormalizeResult {
        if (facts.item["pull_request"] !== undefined) {
            return malformed(
                "commentUnreadable",
                "issue_comment: a comment on a pull request carries no merged state",
            );
        }
        const comment = commentOf(facts);
        if (comment === null) {
            return malformed("commentUnreadable", "issue_comment: comment unreadable");
        }
        return {
            kind: "facts",
            facts: {
                kind: "issue",
                repository: facts.repository,
                item: { kind: "issue", number: facts.number },
                observedAt: facts.observedAt,
                trigger: { kind: "event", event: "issue_comment" },
                author: facts.author,
                actor: facts.actor,
                alerts: facts.alerts,
                position: projectIssue({
                    closedBy: issueClosure(facts.item),
                    meanings: facts.meanings,
                }),
                assignees: UNREAD,
                links: UNREAD,
                command: commandIssued(facts, comment),
            } satisfies ProducedFacts<"issue_comment", "issue">,
        };
    },
} as const;
