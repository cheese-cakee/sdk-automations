/**
 * The sweep's reads: every open item of a repository, and the fact groups
 * `design/guides/sweep.md` §1 names. Nothing is invented — a read that failed and a
 * read the endpoint matrix has not confirmed both leave their group `UNREAD`. And
 * nothing throws: every reader is total over whatever GitHub sent.
 */

import {
    alertsOfLabels,
    labelKey,
    meaningsOfLabels,
    producerReads,
    projectIssue,
    projectPullRequest,
    UNREAD,
    type AdmittedCapability,
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
    advertisesNextPage,
    describeFailure,
    lastPageFromLink,
    repoPath,
    type GitHubHttpClient,
    type GitHubOutcome,
} from "../client/contract.js";
import { createResolverSource } from "./resolvers.js";
import { field, jsonArrayOf, jsonRecordOf } from "../client/untrusted.js";

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

export type SweepRead = (typeof SWEEP_READS)[number];

/**
 * The reads the endpoint-permission matrix records as confirmed, each with its citation.
 * A read absent from this list answers `UNREAD` rather than being called.
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
    // GraphQL `closingIssuesReferences` — Issues R + Pull requests R — `2026-08-29T20-51-00.386Z#same-repository`
    "linkedIssues",
    // `GET /repos/{o}/{r}/pulls/{n}/reviews` — Pull requests R — `2026-09-12T06-31-36-229Z#10` (D156)
    "changesRequested",
    // the item timeline on a PULL REQUEST number — Pull requests R — `2026-09-12T06-31-36-229Z#15`
    "reapableSince",
    // `GET /repos/{o}/{r}/pulls/{n}/commits` — Pull requests R — `2026-09-12T06-31-36-229Z#19`
    "lastCommitAt",
];

/**
 * The reads each group is built from; a group is read only when every one is confirmed.
 * Keyed by `FactGroup`, so a group added to core is a missing property here first.
 */
export const GROUP_READS: { readonly [G in FactGroup]: readonly SweepRead[] } = {
    assignees: ["assignedAt", "lastWorkingAt"],
    links: ["linkedIssues", "assignedAt", "lastWorkingAt"],
    review: ["changesRequested", "reapableSince", "lastCommitAt"],
    /** A WEBHOOK can read `draft` and cannot read the other three (`design/contracts/facts.md` §2). */
    readiness: ["draft"],
    /** The sweep makes no comment record; its `PRODUCERS` row, not this table, stops the group. */
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
 * Every read folds a WHOLE list, so a partial walk is a wrong answer, not a smaller one.
 */
const MAX_PAGES = 10;

/** A read that answered, or the reason it established nothing. */
export type Read<T> =
    { readonly ok: true; readonly value: T } | { readonly ok: false; readonly detail: string };

const unreadable = (detail: string): Read<never> => ({ ok: false, detail });

/**
 * Every entry of a paged list, or the reason there is no complete answer.
 * Walking past `MAX_PAGES` with a successor still advertised is unread, not shorter.
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
        const link = outcome.headers["link"];
        if (page === 1) lastPage = lastPageFromLink(link) ?? lastPage;
        if (page >= lastPage && !advertisesNextPage(link)) return { ok: true, value: entries };
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
 * One open item as `GET /repos/{o}/{r}/issues` carries it.
 * `closedBy` is read rather than assumed: a producer must not assert a fact it did not read.
 */
export interface OpenItem {
    readonly item: ItemRef;
    /** Rides on `openItems`, which the matrix confirmed, so every listed item carries one. */
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
    /** The two mapping families this reader speaks: `mappings.labels` and `mappings.commands.working`. */
    readonly config: RepositoryConfig;
    /** When this sweep is happening — every record's `observedAt`, NOT the item's `updated_at`. */
    readonly clock: () => Date;
    /** Passed straight through to the resolver source this reader builds. */
    readonly knownCapabilities: readonly AdmittedCapability[];
}

/**
 * The seam the sweep driver reads through — sweep.md §2.2.
 * Both record builders take what only the DRIVER holds.
 */
export interface FactsReader {
    openItems(): Promise<OpenItemsOutcome>;
    issueFacts(listed: OpenItem, links: readonly ItemRef[] | Unread): Promise<IssueFacts>;
    pullRequestFacts(listed: OpenItem, openIssues: readonly OpenItem[]): Promise<PullRequestFacts>;
}

// ─── The per-read readers ────────────────────────────────────────────

/**
 * What any read needs to reach one repository: the client, and which one.
 * Named apart from `ReadContext` so a reader here can be reused outside this file.
 */
export interface RepositoryReads {
    readonly http: GitHubHttpClient;
    readonly repository: RepositoryRef;
}

/** The reads below share these three; the reader binds them once per sweep. */
interface ReadContext extends RepositoryReads {
    /** The reviewed mapping, so this context IS a `ResolverSourceOptions`. */
    readonly config: RepositoryConfig;
    readonly knownCapabilities: readonly AdmittedCapability[];
}

const issuePath = ({ repository }: RepositoryReads, number: number): string =>
    `${repoPath(repository)}/issues/${String(number)}`;

const pullPath = ({ repository }: RepositoryReads, number: number): string =>
    `${repoPath(repository)}/pulls/${String(number)}`;

const paged = (url: string, page: number): string =>
    `${url}?per_page=${String(PAGE_SIZE)}&page=${String(page)}`;

/**
 * Every open item, with the fields the list carries.
 * A row this cannot read makes the WHOLE list unusable.
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
 * When each login's current assignment began — the newest `assigned` event per login.
 * Newest rather than first: an unassign-and-reassign starts a new clock.
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
 * The newest `/working` comment per author — the one reset that applies to any clock.
 * The FIRST token only, folded for case the way the label mapping's is.
 */
export async function readLastWorkingAt(
    context: RepositoryReads,
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
 * The reviews list folded to each reviewer's latest DECIDING state.
 * THE ONE FOLD: `readback.ts` calls this rather than folding the list a second time.
 */
export async function readChangesRequested(
    context: RepositoryReads,
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

/**
 * When the pull request entered each reapable mode, or the moment it was opened.
 * The item timeline answers a PULL REQUEST number (`2026-09-12T06-31-36-229Z#15`).
 */
export async function readReapableSince(
    context: ReadContext,
    number: number,
): Promise<Read<Exclude<PullRequestFacts["review"], Unread>["reapableSince"]>> {
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

    const entered = {
        needsRevision: createdAt,
        changesRequested: createdAt,
        draft: createdAt,
    };
    const revisionLabel = context.config.mappings.labels.needsRevision;
    for (const entry of read.value) {
        const kind = field(entry, "event");
        const label = field(field(entry, "label"), "name");
        const reason =
            kind === "convert_to_draft"
                ? "draft"
                : kind === "reviewed" && field(entry, "state") === "changes_requested"
                  ? "changesRequested"
                  : kind === "labeled" &&
                      typeof label === "string" &&
                      revisionLabel !== undefined &&
                      labelKey(label) === labelKey(revisionLabel)
                    ? "needsRevision"
                    : null;
        if (reason === null) continue;
        const at = instant(field(entry, "created_at") ?? field(entry, "submitted_at"));
        if (at === null) {
            return unreadable(`#${String(number)} timeline: a mode event was undated`);
        }
        entered[reason] = newer(entered[reason], at);
    }
    return { ok: true, value: entered };
}

/**
 * The newest commit on the pull request, or `null` when it carries none.
 * `null` is a real answer here, not an unread one.
 */
export async function readLastCommitAt(
    context: RepositoryReads,
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

export async function readPullRequestActivity(
    context: RepositoryReads,
    number: number,
    working: string | undefined,
): Promise<Read<Date | null>> {
    const commit = await readLastCommitAt(context, number);
    if (!commit.ok) return commit;
    if (working === undefined) return commit;
    const comments = await readLastWorkingAt(context, number, working);
    if (!comments.ok) return comments;
    let newest = commit.value;
    for (const at of comments.value.values()) {
        if (newest === null || at.getTime() > newest.getTime()) newest = at;
    }
    return { ok: true, value: newest };
}

/** The three reads the `review` group is one value of. */
type ReviewFacts = Exclude<PullRequestFacts["review"], Unread>;

/**
 * The whole `review` group, read as one: a group is read or it is not.
 * `draft` is the `readiness` group's own, so wanting only it costs one read.
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
 * The clock memo must not outlive the firing, which is why this is a factory.
 */
export function createFactsReader(options: FactsReaderOptions): FactsReader {
    const { config, clock } = options;
    const context: ReadContext = {
        http: options.http,
        repository: options.repository,
        config: options.config,
        knownCapabilities: options.knownCapabilities,
    };
    const working = config.mappings.commands.working;
    const clocks = new Map<number, Promise<Read<readonly AssigneeClock[]>>>();

    /**
     * A group's value, or `UNREAD`.
     * Unpromised, unconfirmed and failed meet here: from a capability's side all three are one fact.
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
     * A login with no `assigned` event makes the whole read unusable, not a clock started now.
     */
    const readClocks = async (
        number: number,
        logins: readonly string[],
    ): Promise<Read<readonly AssigneeClock[]>> => {
        const assigned = await readAssignedAt(context, number);
        if (!assigned.ok) return assigned;
        // No spelling, no command: no comment page is worth a call.

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

    /** One item's assignee clocks, read once per firing. */
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

    // Nothing ARRIVES on a sweep: the empty list is the fact, not a gap in the read.

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
            // A link outside this sweep's open set is not read separately.

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
                actor: null,
                alerts: alerts(listed),
                position: projectIssue({
                    closedBy: listed.closedBy,
                    meanings: meanings(listed),
                }),
                assignees: await groupOf("issue", "assignees", () =>
                    clocksFor(listed.item, listed.assignees),
                ),
                // The driver reads this one, so the row is consulted here, not around a call.

                links:
                    links === UNREAD || !promised("issue", "links")
                        ? UNREAD
                        : { openPullRequests: links },
                // The sweep makes no comment record, so its row leaves this group unread.

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
                review: await groupOf("pullRequest", "review", () =>
                    readReview(context, listed.item.number),
                ),
                readiness: await groupOf("pullRequest", "readiness", async () => {
                    const draft = await readDraft(context, listed.item.number);
                    return draft.ok ? { ok: true, value: { draft: draft.value } } : draft;
                }),
            };
        },
    };
}
