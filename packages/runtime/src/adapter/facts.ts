/**
 * The sweep's reads: every open item of a repository, and the fact groups
 * `design/guides/sweep.md` §1 names, as `IssueFacts` / `PullRequestFacts`.
 *
 * The webhook producer (`core`'s `normalize/`) reads the projection and marks
 * every group unread. This is the OTHER producer, and the whole difference is
 * how much it reads — which is why the clock-driven capabilities need it. What
 * it promises to read is not stated here but in core's `PRODUCERS`, under
 * `sweep`, because a capability's declaration is judged against that row at
 * boot; this file consults the row and never reaches past it.
 *
 * Two rules run through the file. NOTHING IS INVENTED: a read that failed, and
 * a read the endpoint-permission matrix has not confirmed, both leave their
 * group `UNREAD` rather than contributing a shorter list — an empty assignee
 * list is a fact the safety world cannot tell from a lie. And NOTHING THROWS:
 * every reader is total over whatever GitHub sent, in `untrusted.ts`'s idiom,
 * because a sweep that dies on one malformed item stops sweeping the rest.
 *
 * `CONFIRMED_SWEEP_READS` below is the second rule's data. Three of the reads
 * sweep.md §1 names are implemented here and are absent from it: each needs one
 * sandbox protocol run before it may enter the matrix with a citation, and
 * until then the `review` group is `UNREAD` and the pull-request ladder is
 * silent, honestly, by the engine's `factsUnread` finding.
 *
 * Every call is a GET on the pinned origin, or the one GraphQL query
 * `admission.ts` already admits — the gate needed no new arm.
 *
 * In order below: the read set, the paging, the per-read readers, the reader.
 */

import {
    alertsOfLabels,
    meaningsOfLabels,
    producerReads,
    projectIssue,
    projectPullRequest,
    UNREAD,
    type AssigneeClock,
    type ClosureReason,
    type FactGroup,
    type FactKind,
    type IssueFacts,
    type ItemRef,
    type LinkedIssue,
    type PullRequestFacts,
    type RepositoryConfig,
    type RepositoryRef,
    type Unread,
} from "@hiero-hackers/automation-core";
import {
    describeFailure,
    lastPageFromLink,
    repoPath,
    type GitHubHttpClient,
    type GitHubOutcome,
} from "./contract.js";
import { createResolverSource } from "./resolvers.js";
import { field, jsonArrayOf, jsonRecordOf } from "./untrusted.js";

// ─── The read set ────────────────────────────────────────────────────

/** Every read `design/guides/sweep.md` §1 names, one name per row. */
export const SWEEP_READS = [
    "openItems",
    "assignedAt",
    "lastWorkingAt",
    "draft",
    "changesRequested",
    "reapableSince",
    "lastCommitAt",
    "linkedIssues",
] as const;

/** One of `SWEEP_READS`. */
export type SweepRead = (typeof SWEEP_READS)[number];

/**
 * The reads `design/findings/endpoint-permission-matrix.md` records as
 * confirmed, each with the citation that confirmed it.
 *
 * A read absent from this list is implemented below and never called by the
 * reader: its group answers `UNREAD` instead, so a capability that declared
 * the group is skipped with `factsUnread` rather than judging a clock from a
 * number nobody has evidence the App may read. Three are absent —
 * `changesRequested`, `reapableSince` and `lastCommitAt` — and each joins this
 * list when one sandbox protocol run puts its row in the matrix (sweep.md §4).
 */
export const CONFIRMED_SWEEP_READS: readonly SweepRead[] = [
    // `GET /repos/{o}/{r}/issues` — Issues R — `2026-07-23T19-36-29-346Z#1–6`
    "openItems",
    // the item timeline's `assigned` events — Issues R — `2026-07-23T19-38-17-272Z#13`
    "assignedAt",
    // `GET /repos/{o}/{r}/issues/{n}/comments` — Issues R — `2026-07-23T19-41-18-911Z#2`
    "lastWorkingAt",
    // `GET /repos/{o}/{r}/pulls/{n}` — Pull requests R — `2026-07-23T19-41-18-911Z#3`
    "draft",
    // GraphQL `closingIssuesReferences` — Issues R + Pull requests R —
    // `2026-08-29T20-51-00.386Z#same-repository`
    "linkedIssues",
];

/**
 * The reads each group is built from; a group is read only when every one of
 * them is confirmed.
 *
 * Keyed by `FactGroup` so the table cannot fall behind the vocabulary: a group
 * added to core is a missing property here before it is anything else, and
 * `producers.test.ts` reads it to say which groups this producer can fill
 * today as against the ones its registry row promises.
 */
export const GROUP_READS: { readonly [G in FactGroup]: readonly SweepRead[] } = {
    assignees: ["assignedAt", "lastWorkingAt"],
    links: ["linkedIssues", "assignedAt", "lastWorkingAt"],
    review: ["changesRequested", "reapableSince", "lastCommitAt"],
    // `draft` left `review` for a group of its own, and this row is why it
    // could: its single read is confirmed, so the sweep answers draft state
    // for real while `review` waits on three nobody has probed.
    readiness: ["draft"],
    // The sweep makes no comment record, so it reads no command — and the
    // sweep's own row in `PRODUCERS` says so first. Empty here would mean
    // "every read confirmed", which is why the row rather than this table is
    // what stops the group being built.
    command: [],
};

function isConfirmed(read: SweepRead): boolean {
    return CONFIRMED_SWEEP_READS.includes(read);
}

/** Does the sweep's own row in `PRODUCERS` promise this group on this kind? */
function promised(kind: FactKind, group: FactGroup): boolean {
    return producerReads("sweep", kind, group);
}

// ─── The paging ──────────────────────────────────────────────────────

/** GitHub's maximum, so a sweep spends as few calls per item as it can. */
const PAGE_SIZE = 100;

/**
 * How many pages one read may walk before it gives up and answers unread.
 *
 * Every read here folds a WHOLE list — the newest assignment per login, the
 * newest `/working` per author — so a partial walk is not a smaller answer, it
 * is a wrong one. Ten pages is a thousand entries, past anything the fleet
 * design point meets; beyond it the honest answer is that nobody read this.
 */
const MAX_PAGES = 10;

/** A read that answered, or the reason it established nothing. */
export type Read<T> =
    { readonly ok: true; readonly value: T } | { readonly ok: false; readonly detail: string };

const unreadable = (detail: string): Read<never> => ({ ok: false, detail });

/**
 * Every entry of a paged list, or the reason there is no complete answer.
 *
 * Page one names the last page in its `link` header; a header that advertises a
 * successor without naming the last page is refused rather than guessed at,
 * exactly as the ordering reader refuses it — a walk that cannot know where it
 * ends cannot know that it finished.
 */
async function allPages(
    http: GitHubHttpClient,
    pageUrl: (page: number) => string,
    what: string,
): Promise<Read<readonly unknown[]>> {
    const entries: unknown[] = [];
    let lastPage = 1;
    for (let page = 1; page <= MAX_PAGES; page += 1) {
        const at = `${what} page ${String(page)}`;
        const outcome: GitHubOutcome = await http.request({ url: pageUrl(page), method: "GET" });
        if (!outcome.ok) return unreadable(`${at}: ${describeFailure(outcome.failure)}`);
        const read = jsonArrayOf(outcome.body);
        if (read === null) return unreadable(`${at}: the body was not a JSON array`);
        entries.push(...read);
        if (page === 1) {
            const link = outcome.headers["link"];
            const named = lastPageFromLink(link);
            if (named === null) {
                return link !== undefined && link.includes('rel="next"')
                    ? unreadable(`${what}: GitHub advertised a next page without naming the last`)
                    : { ok: true, value: entries };
            }
            lastPage = named;
        }
        if (page >= lastPage) return { ok: true, value: entries };
    }
    return unreadable(`${what}: the list is longer than ${String(MAX_PAGES)} pages`);
}

/** One JSON object from a single unpaged GET, or the reason there is none. */
async function readRecord(
    http: GitHubHttpClient,
    url: string,
    what: string,
): Promise<Read<Record<string, unknown>>> {
    const outcome = await http.request({ url, method: "GET" });
    if (!outcome.ok) return unreadable(`${what}: ${describeFailure(outcome.failure)}`);
    const record = jsonRecordOf(outcome.body);
    return record === null
        ? unreadable(`${what}: the body was not a JSON object`)
        : { ok: true, value: record };
}

/** A field GitHub states as an ISO instant, or `null` when it does not. */
function instant(value: unknown): Date | null {
    if (typeof value !== "string") return null;
    const at = new Date(value);
    return Number.isFinite(at.getTime()) ? at : null;
}

/** The newest of two instants — the fold every "newest per login" read uses. */
function newer(held: Date | undefined, seen: Date): Date {
    return held === undefined || seen.getTime() > held.getTime() ? seen : held;
}

// ─── What the reader is built over ───────────────────────────────────

/**
 * One open item as `GET /repos/{o}/{r}/issues` carries it: the fields the list
 * itself answers, and nothing read separately.
 *
 * `closedBy` is read rather than assumed. The query asks for open items, so it
 * is `null` for every item the list returns today — but the projection judges
 * closure, and a producer that hard-coded "open" would be asserting a fact it
 * did not read.
 */
export interface OpenItem {
    readonly item: ItemRef;
    /**
     * Who opened it. Not a group and not gated on a confirmation: it rides on
     * `openItems`, which the matrix already confirmed, so every item this
     * reader can list at all carries one.
     */
    readonly author: string;
    readonly labels: readonly string[];
    readonly assignees: readonly string[];
    readonly closedBy: ClosureReason | null;
    readonly updatedAt: Date;
}

/** Every open item of the repository, or the reason the list is unusable. */
export type OpenItemsOutcome =
    | { readonly ok: true; readonly items: readonly OpenItem[] }
    | { readonly ok: false; readonly detail: string };

export interface FactsReaderOptions {
    readonly http: GitHubHttpClient;
    readonly repository: RepositoryRef;
    /**
     * The repository's reviewed configuration — the two mapping families this
     * reader speaks. `mappings.labels` is what turns the list's label strings
     * into the projection every gate judges by, and `mappings.commands.working`
     * is the spelling a comment's first token has to fold to before it counts
     * as a clock reset. A repository that mapped no `working` spelling has no
     * such command, so no comment can reset a clock and no comment is read.
     */
    readonly config: RepositoryConfig;
    /**
     * When this sweep is happening — every record's `observedAt`.
     *
     * NOT the item's `updated_at`, which is what a webhook record carries: a
     * clock's elapsed days are measured from `observedAt`, so dating a stale
     * item's record at its own last update would answer zero days idle for
     * every item on the ladder.
     */
    readonly clock: () => Date;
}

/**
 * The seam the sweep driver reads through — sweep.md §2.2.
 *
 * Both record builders take what only the DRIVER holds. An issue's open linked
 * pull requests are the inverse of the pull-request link reads, which the
 * driver has already done by then; a pull request's linked issues are joined to
 * the issues the driver has already listed, so a link to something outside this
 * sweep's open set is dropped rather than read separately.
 */
export interface FactsReader {
    openItems(): Promise<OpenItemsOutcome>;
    issueFacts(listed: OpenItem, links: readonly ItemRef[] | Unread): Promise<IssueFacts>;
    pullRequestFacts(listed: OpenItem, openIssues: readonly OpenItem[]): Promise<PullRequestFacts>;
}

// ─── The per-read readers ────────────────────────────────────────────

/** The reads below share these three; the reader binds them once per sweep. */
interface ReadContext {
    readonly http: GitHubHttpClient;
    readonly repository: RepositoryRef;
    /** The reviewed mapping, so this context IS a `ResolverSourceOptions`. */
    readonly config: RepositoryConfig;
}

const issuePath = ({ repository }: ReadContext, number: number): string =>
    `${repoPath(repository)}/issues/${String(number)}`;

const pullPath = ({ repository }: ReadContext, number: number): string =>
    `${repoPath(repository)}/pulls/${String(number)}`;

const paged = (url: string, page: number): string =>
    `${url}?per_page=${String(PAGE_SIZE)}&page=${String(page)}`;

/**
 * Every open item, with the fields the list carries.
 *
 * A pull request appears in this list too, flagged by its `pull_request`
 * member, which is the whole reason one call covers both kinds. A row this
 * cannot read makes the WHOLE list unusable: a sweep that quietly skipped the
 * items it could not parse would be a sweep that decided about a repository
 * from part of it.
 */
async function readOpenItems(context: ReadContext): Promise<OpenItemsOutcome> {
    const url = `${repoPath(context.repository)}/issues`;
    const read = await allPages(
        context.http,
        (page) => `${paged(url, page)}&state=open`,
        "the open-item list",
    );
    if (!read.ok) return read;

    const items: OpenItem[] = [];
    for (const entry of read.value) {
        const number = field(entry, "number");
        const state = field(entry, "state");
        const updatedAt = instant(field(entry, "updated_at"));
        const labels = labelNamesOf(field(entry, "labels"));
        const assignees = loginsOf(field(entry, "assignees"));
        const author = field(field(entry, "user"), "login");
        if (
            typeof number !== "number" ||
            !Number.isSafeInteger(number) ||
            number < 1 ||
            (state !== "open" && state !== "closed") ||
            updatedAt === null ||
            labels === null ||
            assignees === null ||
            typeof author !== "string" ||
            author.length === 0
        ) {
            return { ok: false, detail: "the open-item list carried an unreadable item" };
        }
        items.push({
            item: {
                kind: field(entry, "pull_request") === undefined ? "issue" : "pullRequest",
                number,
            },
            author,
            labels,
            assignees,
            closedBy: state === "closed" ? "closedByHuman" : null,
            updatedAt,
        });
    }
    return { ok: true, items };
}

/** The label names on a listed item, or `null` when the shape is not GitHub's. */
function labelNamesOf(labels: unknown): readonly string[] | null {
    if (!Array.isArray(labels)) return null;
    const names: string[] = [];
    for (const label of labels) {
        const name = field(label, "name");
        if (typeof name !== "string") return null;
        names.push(name);
    }
    return names;
}

/** The logins in an `assignees` array, or `null` when the shape is not GitHub's. */
function loginsOf(assignees: unknown): readonly string[] | null {
    if (!Array.isArray(assignees)) return null;
    const logins: string[] = [];
    for (const assignee of assignees) {
        const login = field(assignee, "login");
        if (typeof login !== "string" || login.length === 0) return null;
        logins.push(login);
    }
    return logins;
}

/**
 * When each login's current assignment began — the newest `assigned` event per
 * login on the item's timeline.
 *
 * Newest rather than first: an unassign-and-reassign starts a new clock, and
 * the older entry is a previous run of the same person's involvement.
 */
export async function readAssignedAt(
    context: ReadContext,
    number: number,
): Promise<Read<ReadonlyMap<string, Date>>> {
    const read = await allPages(
        context.http,
        (page) => paged(`${issuePath(context, number)}/timeline`, page),
        `#${String(number)} timeline`,
    );
    if (!read.ok) return read;

    const assigned = new Map<string, Date>();
    for (const entry of read.value) {
        if (field(entry, "event") !== "assigned") continue;
        const login = field(field(entry, "assignee"), "login");
        const at = instant(field(entry, "created_at"));
        if (typeof login !== "string" || at === null) {
            return unreadable(`#${String(number)} timeline: an assigned event was unreadable`);
        }
        assigned.set(login, newer(assigned.get(login), at));
    }
    return { ok: true, value: assigned };
}

/** A comment's first token, folded the way a command spelling is compared. */
function firstToken(body: unknown): string | null {
    if (typeof body !== "string") return null;
    const trimmed = body.trim();
    if (trimmed.length === 0) return "";
    return trimmed.split(/\s+/u)[0]!.toLowerCase();
}

/**
 * The newest `/working` comment per author — the one reset that applies to any
 * clock (`design/guides/sweep.md` §1).
 *
 * The FIRST token only: a comment that mentions the command halfway through a
 * sentence is chatter, and chatter is not progress. The comparison folds case,
 * the way the label mapping's does, so a repository that spelled the command
 * `/Working` is matched by what a contributor actually types.
 */
export async function readLastWorkingAt(
    context: ReadContext,
    number: number,
    spelling: string,
): Promise<Read<ReadonlyMap<string, Date>>> {
    const read = await allPages(
        context.http,
        (page) => paged(`${issuePath(context, number)}/comments`, page),
        `#${String(number)} comments`,
    );
    if (!read.ok) return read;

    const wanted = spelling.trim().toLowerCase();
    const working = new Map<string, Date>();
    for (const entry of read.value) {
        const login = field(field(entry, "user"), "login");
        const at = instant(field(entry, "created_at"));
        const token = firstToken(field(entry, "body"));
        if (typeof login !== "string" || at === null || token === null) {
            return unreadable(`#${String(number)} comments: a comment was unreadable`);
        }
        if (token !== wanted) continue;
        working.set(login, newer(working.get(login), at));
    }
    return { ok: true, value: working };
}

/** Whether the pull request is a draft — `GET /repos/{o}/{r}/pulls/{n}`. */
export async function readDraft(context: ReadContext, number: number): Promise<Read<boolean>> {
    const read = await readRecord(
        context.http,
        pullPath(context, number),
        `#${String(number)} pull request`,
    );
    if (!read.ok) return read;
    const draft = read.value["draft"];
    return typeof draft === "boolean"
        ? { ok: true, value: draft }
        : unreadable(`#${String(number)} pull request: draft was not a boolean`);
}

/** Review states that decide the fold below; anything else is a comment on the way past. */
const DECIDING_REVIEW_STATES: ReadonlySet<string> = new Set([
    "APPROVED",
    "CHANGES_REQUESTED",
    "DISMISSED",
]);

/**
 * Whether the pull request's review decision is "changes requested" — the
 * reviews list folded to each reviewer's latest DECIDING state.
 *
 * **Unconfirmed** (sweep.md §1): implemented, and absent from
 * `CONFIRMED_SWEEP_READS` until one sandbox protocol run puts
 * `GET /repos/{o}/{r}/pulls/{n}/reviews` in the endpoint-permission matrix with
 * a citation. Until then the `review` group is `UNREAD`.
 *
 * `COMMENTED` reviews never change a decision — GitHub's own `reviewDecision`
 * ignores them — so folding them in would let a reviewer's later remark cancel
 * the change request they are remarking on.
 */
export async function readChangesRequested(
    context: ReadContext,
    number: number,
): Promise<Read<boolean>> {
    const read = await allPages(
        context.http,
        (page) => paged(`${pullPath(context, number)}/reviews`, page),
        `#${String(number)} reviews`,
    );
    if (!read.ok) return read;

    const latest = new Map<string, string>();
    for (const entry of read.value) {
        const state = field(entry, "state");
        const login = field(field(entry, "user"), "login");
        if (typeof state !== "string" || typeof login !== "string") {
            return unreadable(`#${String(number)} reviews: a review was unreadable`);
        }
        if (DECIDING_REVIEW_STATES.has(state)) latest.set(login, state);
    }
    return { ok: true, value: [...latest.values()].includes("CHANGES_REQUESTED") };
}

/** The timeline events that put a pull request into a contributor-side mode. */
const MODE_EVENTS: ReadonlySet<string> = new Set([
    "convert_to_draft",
    "ready_for_review",
    "review_requested",
]);

/**
 * When the pull request entered the mode it is in now — the newest of its mode
 * events and its newest changes-requested review, or the moment it was opened.
 *
 * **Unconfirmed** (sweep.md §1): implemented, and absent from
 * `CONFIRMED_SWEEP_READS` until one sandbox protocol run confirms the timeline
 * on a PULL REQUEST number. The item timeline is confirmed for issues; that a
 * pull request number answers the same endpoint under the same grant is the
 * part no packet can assert for itself.
 *
 * The fallback is the pull request's own `created_at`, because a pull request
 * that was opened ready and never reviewed has been reapable since it opened —
 * which is a date, not an absence.
 */
export async function readReapableSince(context: ReadContext, number: number): Promise<Read<Date>> {
    const opened = await readRecord(
        context.http,
        pullPath(context, number),
        `#${String(number)} pull request`,
    );
    if (!opened.ok) return opened;
    const createdAt = instant(opened.value["created_at"]);
    if (createdAt === null) {
        return unreadable(`#${String(number)} pull request: created_at was unreadable`);
    }
    const read = await allPages(
        context.http,
        (page) => paged(`${issuePath(context, number)}/timeline`, page),
        `#${String(number)} timeline`,
    );
    if (!read.ok) return read;

    let entered = createdAt;
    for (const entry of read.value) {
        const kind = field(entry, "event");
        const changesRequested =
            kind === "reviewed" && field(entry, "state") === "changes_requested";
        if (typeof kind !== "string" || !(MODE_EVENTS.has(kind) || changesRequested)) continue;
        const at = instant(field(entry, "created_at") ?? field(entry, "submitted_at"));
        if (at === null) {
            return unreadable(`#${String(number)} timeline: a mode event was undated`);
        }
        entered = newer(entered, at);
    }
    return { ok: true, value: entered };
}

/**
 * The newest commit on the pull request, or `null` when it carries none.
 *
 * **Unconfirmed** (sweep.md §1): implemented, and absent from
 * `CONFIRMED_SWEEP_READS` until one sandbox protocol run puts
 * `GET /repos/{o}/{r}/pulls/{n}/commits` in the endpoint-permission matrix
 * with a citation.
 *
 * `null` is a real answer here and not an unread one: a pull request with no
 * commits has no commit date, and the clock it resets simply never started.
 */
export async function readLastCommitAt(
    context: ReadContext,
    number: number,
): Promise<Read<Date | null>> {
    const read = await allPages(
        context.http,
        (page) => paged(`${pullPath(context, number)}/commits`, page),
        `#${String(number)} commits`,
    );
    if (!read.ok) return read;

    let newest: Date | null = null;
    for (const entry of read.value) {
        const committed = field(field(field(entry, "commit"), "committer"), "date");
        const at = instant(committed);
        if (at === null) return unreadable(`#${String(number)} commits: a commit was undated`);
        newest = newest === null ? at : newer(newest, at);
    }
    return { ok: true, value: newest };
}

/** The three reads the `review` group is one value of. */
type ReviewFacts = Exclude<PullRequestFacts["review"], Unread>;

/**
 * The whole `review` group, read as one. Every read must answer: a group is
 * read or it is not, and two thirds of a review is not a review.
 *
 * `draft` is NOT among them any more — it is the `readiness` group's own, read
 * from an endpoint the matrix has confirmed, so a capability wanting only
 * draft state is no longer held behind three reads nobody has probed.
 */
export async function readReview(context: ReadContext, number: number): Promise<Read<ReviewFacts>> {
    const changesRequested = await readChangesRequested(context, number);
    if (!changesRequested.ok) return changesRequested;
    const reapableSince = await readReapableSince(context, number);
    if (!reapableSince.ok) return reapableSince;
    const lastCommitAt = await readLastCommitAt(context, number);
    if (!lastCommitAt.ok) return lastCommitAt;
    return {
        ok: true,
        value: {
            changesRequested: changesRequested.value,
            reapableSince: reapableSince.value,
            lastCommitAt: lastCommitAt.value,
        },
    };
}

// ─── The reader ──────────────────────────────────────────────────────

/**
 * The sweep's reader over one repository, for one firing.
 *
 * The clock memo is what keeps the cost in sweep.md §3: an issue's assignment
 * and `/working` reads are shared between its own record and every pull request
 * that links to it, so a linked issue costs nothing the second time it is
 * named. It must not outlive the firing — the same rule the ordering memo
 * carries, for the same reason — which is why this is a factory.
 */
export function createFactsReader(options: FactsReaderOptions): FactsReader {
    const { config, clock } = options;
    const context: ReadContext = {
        http: options.http,
        repository: options.repository,
        config: options.config,
    };
    const working = config.mappings.commands.working;
    const clocks = new Map<number, Promise<Read<readonly AssigneeClock[]>>>();

    /**
     * A group's value, or `UNREAD`.
     *
     * The three ways a group goes unread meet here on purpose. A group this
     * producer's registry row does not promise is never attempted, a read the
     * matrix has not confirmed is never attempted, and a read that was
     * attempted and failed contributes nothing either — because from a
     * capability's side all three are the same fact: nobody read this, so do
     * not decide from it.
     */
    const groupOf = async <T>(
        kind: FactKind,
        group: FactGroup,
        read: () => Promise<Read<T>>,
    ): Promise<T | Unread> => {
        if (!promised(kind, group)) return UNREAD;
        if (!GROUP_READS[group].every(isConfirmed)) return UNREAD;
        const answer = await read();
        return answer.ok ? answer.value : UNREAD;
    };

    /**
     * One item's assignees, as clocks.
     *
     * The logins come from the list row rather than from a read of their own —
     * the list already carries them, and re-reading would answer a question
     * already asked. A login with no `assigned` event makes the whole read
     * unusable rather than a clock started now: the alternative is reaping from
     * a start date the platform invented.
     */
    const readClocks = async (
        number: number,
        logins: readonly string[],
    ): Promise<Read<readonly AssigneeClock[]>> => {
        const assigned = await readAssignedAt(context, number);
        if (!assigned.ok) return assigned;
        // No spelling, no command: nobody can have typed it, so no comment page
        // is worth a call and every reset is honestly absent.
        const worked =
            working === undefined
                ? { ok: true as const, value: new Map<string, Date>() }
                : await readLastWorkingAt(context, number, working);
        if (!worked.ok) return worked;

        const built: AssigneeClock[] = [];
        for (const login of logins) {
            const assignedAt = assigned.value.get(login);
            if (assignedAt === undefined) {
                return unreadable(`#${String(number)}: no assignment event for "${login}"`);
            }
            built.push({ login, assignedAt, lastWorkingAt: worked.value.get(login) ?? null });
        }
        return { ok: true, value: built };
    };

    /**
     * One item's assignee clocks, read once per firing.
     *
     * The memo is what keeps a linked issue free: its clocks are read for its
     * own record and named again by every pull request that closes it, and the
     * second naming costs nothing.
     */
    const clocksFor = (
        item: ItemRef,
        logins: readonly string[],
    ): Promise<Read<readonly AssigneeClock[]>> => {
        let pending = clocks.get(item.number);
        if (pending === undefined) {
            pending = readClocks(item.number, logins);
            clocks.set(item.number, pending);
        }
        return pending;
    };

    const meanings = (listed: OpenItem) => meaningsOfLabels(config, listed.labels);

    // Nothing ARRIVES on a sweep: a clock fired, and no label moved for us to
    // have seen it move. The empty list is the fact, not a gap in the read.
    const alerts = (listed: OpenItem) => ({
        carried: alertsOfLabels(config, listed.labels),
        arrived: [],
    });

    /** The linked issues of one pull request, joined to the issues already listed. */
    const linksFor = async (
        number: number,
        openIssues: readonly OpenItem[],
    ): Promise<Read<readonly LinkedIssue[]>> => {
        const answer = await createResolverSource(context)("linkedIssues", {
            item: { kind: "pullRequest", number },
        });
        if (!answer.ok) return unreadable(`#${String(number)} linked issues: ${answer.detail}`);

        const linked: LinkedIssue[] = [];
        for (const reference of answer.value) {
            const listed = openIssues.find((open) => open.item.number === reference.number);
            // A link to a closed issue, or to one outside this sweep's open set,
            // is not something to read separately: the group is about the open
            // items a close would release alongside.
            if (listed === undefined) continue;
            const read = await clocksFor(listed.item, listed.assignees);
            if (!read.ok) return read;
            linked.push({ item: listed.item, assignees: read.value });
        }
        return { ok: true, value: linked };
    };

    return {
        openItems: () => readOpenItems(context),

        async issueFacts(listed, links) {
            return {
                kind: "issue",
                repository: options.repository,
                item: listed.item,
                observedAt: clock(),
                trigger: { kind: "sweep" },
                author: listed.author,
                // Nobody caused a sweep. `null` is the fact, not an unread
                // group: the clock fired, and no person is behind this record.
                actor: null,
                alerts: alerts(listed),
                position: projectIssue({
                    closedBy: listed.closedBy,
                    meanings: meanings(listed),
                }),
                assignees: await groupOf("issue", "assignees", () =>
                    clocksFor(listed.item, listed.assignees),
                ),
                // The driver reads this one — an issue's open pull requests are
                // the inverse of link reads it has already done — so the row is
                // consulted here rather than around a call.
                links:
                    links === UNREAD || !promised("issue", "links")
                        ? UNREAD
                        : { openPullRequests: links },
                // The sweep makes no comment record, so its row leaves this
                // group unread and `groupOf` never runs a reader for it.
                command: UNREAD,
            };
        },

        async pullRequestFacts(listed, openIssues) {
            const links = await groupOf("pullRequest", "links", () =>
                linksFor(listed.item.number, openIssues),
            );
            return {
                kind: "pullRequest",
                repository: options.repository,
                item: listed.item,
                observedAt: clock(),
                trigger: { kind: "sweep" },
                author: listed.author,
                actor: null,
                alerts: alerts(listed),
                position: projectPullRequest({
                    closedBy: listed.closedBy,
                    meanings: meanings(listed),
                }),
                assignees: await groupOf("pullRequest", "assignees", () =>
                    clocksFor(listed.item, listed.assignees),
                ),
                links: links === UNREAD ? UNREAD : { issues: links },
                // The one read this file never performs. `groupOf` short-circuits
                // on `GROUP_READS.review`, three of which no protocol has
                // confirmed, so the line below stands unexecuted until they are —
                // which is exactly what "promised, and honestly unread" looks
                // like, and why the row rather than the record is what a
                // declaration is judged against.
                review: await groupOf("pullRequest", "review", () =>
                    readReview(context, listed.item.number),
                ),
                // Unlike `review`, this one DOES run: its single read is
                // confirmed, so the sweep answers draft state for real.
                readiness: await groupOf("pullRequest", "readiness", async () => {
                    const draft = await readDraft(context, listed.item.number);
                    return draft.ok ? { ok: true, value: { draft: draft.value } } : draft;
                }),
            };
        },
    };
}
