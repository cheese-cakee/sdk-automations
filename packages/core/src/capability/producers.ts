/**
 * Who reads what: every producer of fact records, and the groups each one
 * fills on a record it makes.
 *
 * `catalogue.ts` answers what a capability may NAME. This file answers what a
 * record will actually hold, which is the other half of the same promise and
 * the half a declaration cannot see for itself. A capability declares `needs`,
 * a trigger names a producer, and only the table below says whether the two
 * ever meet — without it, a need on a trigger whose producer never reads the
 * group is dead code, skipped in silence on every delivery
 * (the capability study of 2026-09-10, its second defect).
 *
 * THE TABLE IS THE PROMISE, NOT THE RECORD. A producer reads what its row says
 * it will attempt; a read that fails, and a read the endpoint-permission
 * matrix has not confirmed, still leave their group `"unread"` on the day. The
 * boot check is what stops a capability being written that could never run;
 * `decide()`'s `factsUnread` skip stays as the last line of defence for the
 * record that falls short of the promise.
 *
 * ADDING A PRODUCER is one name and one row. Every module that builds records
 * for it types itself `ProducedFacts` and cannot then fill a group its row
 * omits. `design/contracts/facts.md` §2 is generated from the table.
 */

import type { FactGroup, FactKind, Facts, Unread } from "./catalogue.js";

/**
 * The producers that wake on a webhook delivery — and, because a trigger names
 * a producer by its event, the events core consumes. `engine/events.ts` routes
 * from this list, so a name here with no normalizer does not compile.
 */
export const WEBHOOK_PRODUCERS = ["issues", "issue_comment", "pull_request"] as const;

/** One of `WEBHOOK_PRODUCERS`. */
export type WebhookProducer = (typeof WEBHOOK_PRODUCERS)[number];

/** Every producer. The sweep is the one that is not an event. */
export const PRODUCER_NAMES = [...WEBHOOK_PRODUCERS, "sweep"] as const;

/** One of `PRODUCER_NAMES`. */
export type ProducerName = (typeof PRODUCER_NAMES)[number];

/**
 * Per producer and fact kind, the groups it reads — `null` where the producer
 * makes no record of that kind at all.
 *
 * The mapped type is the completeness check: a producer with no row, or a row
 * missing a kind, fails to compile here and nowhere else (D76).
 */
type ProducerTable = {
    readonly [P in ProducerName]: { readonly [K in FactKind]: readonly FactGroup[] | null };
};

/**
 * The registry.
 *
 * `satisfies` rather than a `:` annotation, and the constraint is load-bearing:
 * an annotation widens every row to `FactGroup[]`, and `ProducedFacts` below
 * then admits any group on any producer.
 */
export const PRODUCERS = {
    issues: { issue: [], pullRequest: null },
    // A comment delivery reads the command and nothing else: the payload
    // carries an assignee list with no clocks on it, and an assignment whose
    // start nobody read is not one the safety world may reason from. It makes
    // no pull-request record at all — a comment on a pull request carries no
    // `merged`, and closure is exactly what `merged` decides (D47).
    issue_comment: { issue: ["command"], pullRequest: null },
    // `readiness` is read and `review` is not: the payload carries `draft`
    // whole, while the three facts left in `review` need the timeline.
    pull_request: { issue: null, pullRequest: ["readiness"] },
    sweep: {
        issue: ["assignees", "links"],
        pullRequest: ["assignees", "links", "review", "readiness"],
    },
} as const satisfies ProducerTable;

/** The same table widened, so the questions below can index it with a variable. */
const ROWS: ProducerTable = PRODUCERS;

function isName<T extends string>(names: readonly T[], name: string): name is T {
    return names.some((known) => known === name);
}

/** Is this the name of a producer that wakes on a webhook delivery? */
export function isWebhookProducer(name: string): name is WebhookProducer {
    return isName(WEBHOOK_PRODUCERS, name);
}

/** Does this producer make records of this kind at all? */
export function producesKind(producer: ProducerName, kind: FactKind): boolean {
    return ROWS[producer][kind] !== null;
}

/** Does this producer read this group on a record of this kind? */
export function producerReads(producer: ProducerName, kind: FactKind, group: FactGroup): boolean {
    return ROWS[producer][kind]?.includes(group) ?? false;
}

/** The producers that do read this group — what a boot refusal names instead. */
export function producersReading(kind: FactKind, group: FactGroup): readonly ProducerName[] {
    return PRODUCER_NAMES.filter((producer) => producerReads(producer, kind, group));
}

/** The groups producer `P` reads on kind `K`, as a union of their names. */
export type GroupsReadBy<
    P extends ProducerName,
    K extends FactKind,
> = (typeof PRODUCERS)[P][K] extends readonly (infer G extends FactGroup)[] ? G : never;

/**
 * The record shape producer `P` may build for kind `K`: every group its row
 * omits is `Unread` and nothing else, and a kind whose row is `null` is
 * `never`, so a module cannot build a record its registry row denies.
 *
 * The groups the row DOES name keep their `| Unread`, because the row is the
 * promise and an attempted read may still come back with nothing.
 */
export type ProducedFacts<
    P extends ProducerName,
    K extends FactKind,
> = (typeof PRODUCERS)[P][K] extends readonly FactGroup[]
    ? {
          readonly [Key in keyof Extract<Facts, { kind: K }>]: Key extends FactGroup
              ? Key extends GroupsReadBy<P, K>
                  ? Extract<Facts, { kind: K }>[Key]
                  : Unread
              : Extract<Facts, { kind: K }>[Key];
      }
    : never;
