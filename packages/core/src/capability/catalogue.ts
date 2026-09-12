/**
 * The closed platform vocabularies — the facts a capability may read, every
 * resolver it may ask, every intent it may express — plus the words in which
 * the PLATFORM's per-operation facts are stated. The operation facts
 * themselves live one module each, in `operations/`.
 *
 * ADDING AN OPERATION touches two places: one module in `operations/`, and one
 * key in `IntentCatalogue` here. The registry's mapped type is the check — a
 * key with no module fails to compile there. `describeChange` in the engine is
 * generic now and states nothing per operation.
 *
 * D61: a capability chooses from these; it cannot extend them. The
 * alternative is unimplementable at the far end, because a writer could
 * receive a type it has never seen. Isolation (P3) falls out:
 * capabilities that share no vocabulary have nothing to call each other
 * through.
 */

import type { Command, MappableMeaning } from "../config/index.js";
import type { PermissionGrant } from "../github/index.js";
import type { ActionClass } from "../safety/index.js";
import type {
    EntityKind,
    IssueMeaning,
    PrMeaning,
    Projection,
    TransitionCause,
} from "../workflow/index.js";

// ─── References and explanations ─────────────────────────────────────

export interface RepositoryRef {
    readonly owner: string;
    readonly repo: string;
}

/** GitHub numbers issues and pull requests in one sequence per repository. */
export interface ItemRef {
    readonly kind: EntityKind;
    readonly number: number;
}

/**
 * contracts/safety.md's explanation requirement as structure rather
 * than prose: `summary` is the human sentence, `detail` the supporting
 * facts, `capability` the attribution every managed write owes. Kept
 * structured so the managed comment, the dry-run report, and the operator
 * surface render the SAME explanation instead of three drifting strings.
 */
export interface StructuredExplanation {
    readonly capability: string;
    readonly summary: string;
    readonly detail: readonly string[];
}

/** contract.md §3 — a cause is always dated (contracts/safety.md). */
export interface DatedCause {
    readonly cause: string;
    readonly observedAt: Date;
}

// ─── The facts a capability reads ────────────────────────────────────

/**
 * What woke the platform. Metadata a capability may log, never branch on
 * (contracts/facts.md §6): one that behaved differently on a sweep than on an
 * event would be deciding from the platform's schedule rather than from the
 * item's facts.
 */
export type Trigger =
    { readonly kind: "event"; readonly event: string } | { readonly kind: "sweep" };

/**
 * A group the producer did not read. A capability that declared the group
 * never sees it: the engine records `factsUnread` and skips instead.
 */
export type Unread = "unread";

/** The one value `Unread` has — what a producer marks an unread group with. */
export const UNREAD: Unread = "unread";

/**
 * Whoever caused this record to exist, or `null` when nobody did.
 *
 * `null` is the sweep's honest answer and is NOT an `Unread`: a swept item was
 * read because a clock fired, so "no actor" is a fact about the record rather
 * than a group the producer skipped. A capability that needs to know who acted
 * must handle both, and the difference is what stops it reading a scheduled
 * read as a person's edit.
 *
 * The login is GitHub's, unresolved: `isAutomationActor` is what turns it into
 * "was this the App", and the capability asks rather than pattern-matching the
 * `[bot]` suffix itself.
 */
export interface Actor {
    readonly login: string;
}

/**
 * The alerts an item carries, and the ones that arrived in this observation.
 *
 * Two lists because the design that needed them asks two different questions,
 * and one list answering both is what would make a ping fire on a label that
 * had sat there for months. `carried` is the item's state; `arrived` is what
 * this observation was ABOUT.
 *
 * `arrived` is empty on a sweep, and that is a fact rather than an omission —
 * a clock fired and nothing arrived. It is also empty on any webhook that was
 * not a label being added, so a capability reading it is reading what changed
 * rather than what triggered the platform (facts.md §6 permits the first and
 * forbids the second).
 */
export interface Alerts {
    readonly carried: readonly string[];
    readonly arrived: readonly string[];
}

/**
 * The command a contributor typed in a comment on this item, as the platform
 * read it — the `command` group's whole content.
 *
 * The COMMAND is a catalogue name (`assign`), never the repository's spelling
 * of it (`/assign`, `/take`): the producer projects the comment body through
 * `mappings.commands` exactly as it projects labels through `mappings.labels`,
 * so contract.md §2's "never a repository's word for a thing" holds for the
 * command vocabulary too.
 *
 * `by` is the login that typed it, and `at` when it was typed — the occasion a
 * claim is dated by. Neither is a judgement: whether that login is a person is
 * `isAutomationActor`'s answer, not this record's.
 */
export interface CommandFacts {
    readonly command: Command;
    readonly by: string;
    readonly at: Date;
}

/** One assignee of an item, with the clock that assignment started. */
export interface AssigneeClock {
    readonly login: string;
    /** When this assignment began — the clock's start. */
    readonly assignedAt: Date;
    /** The last `/working` comment by this person, the one reset that applies to any clock. */
    readonly lastWorkingAt: Date | null;
}

/** A pull request's linked issue, carrying its own assignees' clocks. */
export interface LinkedIssue {
    readonly item: ItemRef;
    readonly assignees: readonly AssigneeClock[];
}

/**
 * One issue, as the platform read it — `design/contracts/facts.md` §1.
 *
 * Everything here is NORMALIZED fact: a projection rather than labels,
 * meanings rather than the repository's words for them, dates rather than
 * timeline entries. `position` is never a group because every producer reads
 * it and the safety world is derived from it — an unprojected record would
 * refuse every intent `preconditionStale` (D141).
 *
 * Beyond the projection, each GROUP is read or marked `Unread`. A producer
 * marks rather than invents: an empty assignee list from a webhook would be a
 * lie the safety world cannot tell from a fact.
 */
export interface IssueFacts {
    readonly kind: "issue";
    readonly repository: RepositoryRef;
    readonly item: ItemRef;
    readonly observedAt: Date;
    readonly trigger: Trigger;
    /**
     * Who opened the item. A plain field rather than a group because every
     * producer can always read it — the webhook payload's `user.login`, the
     * sweep's own list — so there is no honest `Unread` for it to take.
     */
    readonly author: string;
    /** Who caused this record, or `null` on a sweep. Never a group. */
    readonly actor: Actor | null;
    /** Always read: the projection every gate judges by. */
    readonly position: Projection<IssueMeaning>;
    /** The open-keyed family: what this item carries, and what just arrived. */
    readonly alerts: Alerts;
    readonly assignees: readonly AssigneeClock[] | Unread;
    readonly links: { readonly openPullRequests: readonly ItemRef[] } | Unread;
    /**
     * `null` is a READ group whose delivery carried no command — an ordinary
     * comment, or one spelling a word this repository has not mapped. Only
     * `UNREAD` means nobody looked, which is the distinction the whole group
     * mechanism exists for.
     */
    readonly command: CommandFacts | null | Unread;
}

/**
 * One pull request, as the platform read it. `IssueFacts`'s notes on
 * normalized fact, on the projection and on unread groups hold unchanged.
 *
 * `review.reapableSince` is one date for whichever contributor-side mode the
 * pull request is in, because a ladder judges the mode it is in now: a draft
 * that later gains a changes-requested review restarts from the newer of the
 * two.
 */
export interface PullRequestFacts {
    readonly kind: "pullRequest";
    readonly repository: RepositoryRef;
    readonly item: ItemRef;
    readonly observedAt: Date;
    readonly trigger: Trigger;
    /** Who opened the pull request — always read, as on an issue. */
    readonly author: string;
    /** Who caused this record, or `null` on a sweep. Never a group. */
    readonly actor: Actor | null;
    readonly position: Projection<PrMeaning>;
    /** The open-keyed family: what this item carries, and what just arrived. */
    readonly alerts: Alerts;
    readonly assignees: readonly AssigneeClock[] | Unread;
    /** Each linked issue with its own assignees' clocks — what a close releases alongside. */
    readonly links: { readonly issues: readonly LinkedIssue[] } | Unread;
    readonly review:
        | {
              /** GitHub's review decision is "changes requested". */
              readonly changesRequested: boolean;
              /** When the pull request entered its current reapable mode, or was opened. */
              readonly reapableSince: Date;
              readonly lastCommitAt: Date | null;
          }
        | Unread;
    /**
     * Whether the author has offered the pull request for review yet.
     *
     * Its own group rather than a member of `review`, because it is the one
     * readiness fact a WEBHOOK can read: the payload carries `draft`, and the
     * three facts left in `review` need the timeline. A capability wanting only
     * draft state would otherwise have to declare `review` and be skipped on
     * every delivery it was triggered by.
     */
    readonly readiness: { readonly draft: boolean } | Unread;
}

/** One record, one item — whatever woke the platform. */
export type Facts = IssueFacts | PullRequestFacts;

/** The item kinds a capability may declare. */
export const FACT_KINDS = ["issue", "pullRequest"] as const;

/** One of `FACT_KINDS`. */
export type FactKind = (typeof FACT_KINDS)[number];

/** The groups a capability may declare a need for. */
export const FACT_GROUPS = ["assignees", "links", "review", "readiness", "command"] as const;

/** One of `FACT_GROUPS`. */
export type FactGroup = (typeof FACT_GROUPS)[number];

/**
 * How each kind holds each group, or `null` where the kind carries none.
 *
 * One table answers both questions the platform asks — may a declaration need
 * this group, and did the producer read it on this record — so the two can
 * never disagree. A group added to `FACT_GROUPS` is a missing property here,
 * once per kind, before it is anything else. Keys rather than readers, so the
 * table is data the coverage gate has nothing to say about.
 */
const GROUP_KEYS: {
    readonly [K in FactKind]: {
        readonly [G in FactGroup]: (keyof Extract<Facts, { kind: K }> & FactGroup) | null;
    };
} = {
    issue: {
        assignees: "assignees",
        links: "links",
        review: null,
        readiness: null,
        command: "command",
    },
    pullRequest: {
        assignees: "assignees",
        links: "links",
        review: "review",
        readiness: "readiness",
        command: null,
    },
};

/**
 * Does this kind carry the group at all? `review` and `readiness` are the pull
 * request's alone, `command` the issue's — a comment on a pull request carries
 * no `merged`, so no honest pull-request record is made from one.
 */
export function carriesFactGroup(kind: FactKind, group: FactGroup): boolean {
    return GROUP_KEYS[kind][group] !== null;
}

/**
 * Did the producer leave this group unread on this record?
 *
 * `false` for a group the kind does not carry: a need no record of that kind
 * could ever hold is refused at boot, so it must not also become a silent skip
 * at evaluation time.
 */
export function factGroupUnread(facts: Facts, group: FactGroup): boolean {
    if (facts.kind === "issue") {
        const key = GROUP_KEYS.issue[group];
        return key !== null && facts[key] === UNREAD;
    }
    const key = GROUP_KEYS.pullRequest[group];
    return key !== null && facts[key] === UNREAD;
}

// A catalogue's keys must be exactly its name list: the `extends Record<Name,
// unknown>` on the interface forces every NAME to have an entry, and this
// forces the reverse. An entry with no name is a compile error here and
// nowhere else, because nothing reads the interface at runtime.
type AssertNever<T extends never> = T;
// ─── The resolver catalogue ──────────────────────────────────────────

/** Every question a capability may ask the platform. */
export const RESOLVER_NAMES = [
    "linkedIssues",
    "isAutomationActor",
    "commitAttestations",
    "mergeability",
    "assigneesOf",
    "openAssignments",
] as const;

/** One of `RESOLVER_NAMES`. */
export type ResolverName = (typeof RESOLVER_NAMES)[number];

/**
 * One commit of a pull request, in the four facts a quality check judges.
 *
 * `summary` is the first line of the message and NOTHING ELSE: the body is
 * where a contributor pastes stack traces and where an attacker pastes markup,
 * and no check reads it. It is still untrusted text — whoever renders it owes
 * it `inert()` (`facts.ts`).
 *
 * `merge` is here because the DCO rule exempts merge commits, which GitHub
 * writes itself and never signs off, and a reader cannot tell one from the
 * message.
 */
export interface CommitAttestation {
    readonly sha: string;
    /** The first line of the commit message — untrusted text. */
    readonly summary: string;
    /** The message carries a `Signed-off-by:` trailer. */
    readonly signedOff: boolean;
    /** GitHub reports `verification.verified` for this commit. */
    readonly verified: boolean;
    /** More than one parent — GitHub's own merge commit, exempt from DCO. */
    readonly merge: boolean;
}

/** Every resolver's question and answer shape; the catalogue table is generated from it. */
export interface ResolverCatalogue extends Record<ResolverName, unknown> {
    readonly linkedIssues: {
        readonly input: { readonly item: ItemRef };
        readonly output: readonly ItemRef[];
    };
    readonly isAutomationActor: {
        readonly input: { readonly login: string };
        readonly output: boolean;
    };
    /**
     * Every commit of a pull request. A list GitHub truncates is not a shorter
     * answer, it is no answer: the resolver fails rather than reporting the
     * first page as though it were all of them: unknown is not an answer.
     */
    readonly commitAttestations: {
        readonly input: { readonly item: ItemRef };
        readonly output: readonly CommitAttestation[];
    };
    /**
     * Can GitHub merge this pull request cleanly? GitHub computes this
     * asynchronously and reports `null` while it is thinking, which is a
     * failure to answer rather than a `false`.
     */
    readonly mergeability: {
        readonly input: { readonly item: ItemRef };
        readonly output: boolean;
    };
    /**
     * Who is assigned to one item right now, by login — never a bot filter,
     * and never this record's own `assignees` group: that group is read by a
     * producer about THIS item, and this question is asked about another item
     * entirely, which is why the item is the input.
     */
    readonly assigneesOf: {
        readonly input: { readonly item: ItemRef };
        readonly output: readonly string[];
    };
    /**
     * Every open issue in THIS repository one login is assigned to, each with
     * the meanings its labels projected to.
     *
     * The meanings ride along because the arithmetic needs them: a cap that
     * ignores `needsReview` cannot be counted from a bare list, and a second
     * question per item would be a call per assignment. Repo-local by
     * construction (D57) — the resolver is built for one repository and can
     * name no other.
     */
    readonly openAssignments: {
        readonly input: { readonly login: string };
        readonly output: readonly {
            readonly item: ItemRef;
            readonly meanings: readonly MappableMeaning[];
        }[];
    };
}
type _ResolverCatalogueNamesAreExact = AssertNever<Exclude<keyof ResolverCatalogue, ResolverName>>;

/** What a resolver is asked. */
export type ResolverInput<Q extends ResolverName> = ResolverCatalogue[Q]["input"];

/** What it answers with, before `ResolverAnswer` wraps the failure case. */
export type ResolverOutput<Q extends ResolverName> = ResolverCatalogue[Q]["output"];

/**
 * "Unknown is not an answer" (`design/contracts/catalogue.md`), as a type a
 * capability cannot ignore: an empty answer and an answer that could not be
 * determined are different values, not both `[]`. A capability must never read "the API failed" as "no linked
 * issue exists" — the union makes the distinction unavoidable rather than
 * documented.
 */
export type ResolverAnswer<T> =
    | { readonly ok: true; readonly value: T }
    | {
          readonly ok: false;
          readonly reason: "noPermission" | "rateLimited" | "unavailable" | "notConfigured";
          readonly detail: string;
      };

// ─── The intent catalogue ────────────────────────────────────────────

/**
 * The purposes a managed comment may serve — one per comment, and the half of
 * its identity a capability chooses.
 *
 * The catalogue allows one short marker per PURPOSE per item, so the
 * purpose has to be part of the identity: without it a capability holding both
 * a standing summary and a warning on one item could not tell them apart. The
 * vocabulary is closed for the reason the rest of the catalogue is (D61) — a
 * writer must never receive a purpose it has no rendering for.
 *
 * `summary` is a standing statement about the item, updated in place.
 * `warning` is advance notice of an action the App will take, and carries the
 * facts `design/guides/grace.md` §1 requires of one. `notice` records that something already happened.
 */
export const MANAGED_COMMENT_KINDS = ["summary", "warning", "notice"] as const;

/** One of `MANAGED_COMMENT_KINDS`. */
export type ManagedCommentKind = (typeof MANAGED_COMMENT_KINDS)[number];

/**
 * The desired-outcome payload per operation (contract.md §3 `desired`).
 *
 * `postManagedComment` carries content and purpose, and no marker: identity is
 * platform-owned (D125), derived in `managed.ts` from the intent's own fields.
 * A capability that could write a marker could address another capability's
 * comment, or a purpose that is not its own. `topic` is the one part of
 * identity a capability chooses and it is not a marker: a short discriminator,
 * defaulting to `""`, for a purpose that may legitimately stand more than once
 * on an item — an assignee's login on a per-person warning (D145).
 *
 * `applyMappedLabel` SETS the item's position; it is not "add a label". The
 * adapter removes the position label the item previously held as part of
 * realising it (D4). There is deliberately no `removeMappedLabel`: leaving a
 * position without closing has no edge on the map, and unpausing needs the
 * human authority D79 reserves — an operation with no legal use is dead
 * vocabulary in a closed catalogue (D80).
 *
 * It is also the only operation that MOVES an item, which is why its `cause`
 * comes from the closed, entity-scoped list in `workflow/causes.ts` rather
 * than the free-text `DatedCause` the others carry; `screenIntent` checks the
 * edge (D78).
 *
 * `assign` puts one login on an item's assignees and is the only operation a
 * contributor asks for on their own behalf; it is `reversibleStateChange`,
 * because `unassign` undoes it exactly.
 *
 * `lockIssue` and `unlockIssue` are the two directions of one moderation, kept
 * apart for the reason `unassign` and `releaseAssignment` are: a journal row
 * should name the direction it went rather than carry a boolean an operator
 * has to decode, and the two have no shared postcondition to fold into one.
 * Each carries the sentence it is recorded under.
 *
 * `unassign` and `releaseAssignment` remove the same person from the same list
 * and are two operations on purpose (D63, D141): `unassign` is the reversible
 * self-release a contributor asks for, `releaseAssignment` is the clock's, and
 * only the second passes the warning-and-grace gates. `closePullRequest`
 * carries the sentence its close notice states, so the journal row names the
 * reason a maintainer will read.
 */
export interface IntentCatalogue {
    readonly postManagedComment: {
        readonly kind: ManagedCommentKind;
        readonly topic?: string;
        readonly body: string;
        /**
         * A principal to address the comment to, by NAME, or absent for a
         * comment addressed to nobody.
         *
         * A NAME and never a team string, for the reason `desired.meaning` is
         * a meaning and never a label: the repository's word for a role is the
         * capability's business and the handle behind it is the adapter's. The
         * platform resolves the one into the other when it composes the body
         * (`managed.ts` → `addressManagedComment`), so a capability that wants
         * to ping someone never learns who it pinged.
         *
         * It is NOT part of identity, which `topic` is: the same purpose
         * addressed to two different principals is still one standing comment
         * on the item, and re-addressing it updates it in place (D145).
         */
        readonly mention?: string;
    };
    readonly applyMappedLabel: {
        readonly meaning: MappableMeaning;
        readonly cause: TransitionCause;
    };
    readonly assign: { readonly login: string };
    readonly unassign: { readonly login: string };
    readonly releaseAssignment: { readonly login: string };
    readonly closePullRequest: { readonly reason: string };
    readonly lockIssue: { readonly reason: string };
    readonly unlockIssue: { readonly reason: string };
}

/** One of the catalogue's keys — the closed set of operations. */
export type IntentOperation = keyof IntentCatalogue & string;

/**
 * How a retry must behave after a lost response — experiment 6.5's
 * classes. `idempotent`: re-sending cannot duplicate the outcome (label
 * add). `nonIdempotent`: a blind retry duplicates; recovery must go
 * through the read-back path (comment create).
 */
export type IdempotencyClass = "idempotent" | "nonIdempotent";

/**
 * The facts the platform owns about an operation — never the capability.
 * `actionClassFloor` retains its catalogue name but is the class supplied to
 * safety now that capabilities cannot restate or elevate it.
 */
export interface OperationFacts {
    readonly idempotencyClass: IdempotencyClass;
    readonly actionClassFloor: ActionClass;
    readonly permission: PermissionGrant;
}
