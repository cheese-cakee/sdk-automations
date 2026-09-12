/**
 * The adapter's answers to the questions core lets a capability ask: one
 * arm per name in core's `RESOLVER_NAMES`, and nothing else.
 *
 * Every answer is VERIFIED on this side rather than taken on trust. A
 * linked-issue page must name the repository and the pull request that
 * were asked about, a page claiming a successor must carry a cursor that
 * is new, and paging stops at `MAX_LINKED_ISSUE_PAGES`. Whatever fails a
 * check becomes a typed failure, never a shorter list: a capability
 * reading `[]` as "no linked issue" would act on a rate limit
 * (`design/contracts/catalogue.md`, "unknown is not an answer").
 *
 * `CONFIRMED_RESOLVER_READS` is the second rule, and it is `facts.ts`'s rule
 * one directory over: a read the endpoint matrix has not confirmed is
 * IMPLEMENTED here and answered `unavailable`, never sent. A resolver is a
 * question a capability asks before it acts, so an unconfirmed read that
 * answered anyway would be the capability acting on evidence nobody has
 * established the App may gather. Each such name joins the list when one
 * sandbox protocol run puts its row in the matrix with a citation.
 */

import {
    isAutomationLogin,
    meaningsOfLabels,
    type CommitAttestation,
    type ItemRef,
    type MappableMeaning,
    type RepositoryConfig,
    type RepositoryRef,
    type ResolverAnswer,
    type ResolverName,
    type ResolverOutput,
    type ResolverSource,
} from "@hiero-hackers/automation-core";
import {
    describeFailure,
    GITHUB_GRAPHQL_URL,
    lastPageFromLink,
    repoPath,
    type GitHubFailure,
    type GitHubHttpClient,
    type GitHubSuccess,
} from "./contract.js";
import { field, jsonArrayOf, jsonRecordOf } from "./untrusted.js";

const LINKED_ISSUES_QUERY = `query LinkedIssues(
  $owner: String!
  $repo: String!
  $number: Int!
  $after: String
) {
  repository(owner: $owner, name: $repo) {
    nameWithOwner
    pullRequest(number: $number) {
      number
      closingIssuesReferences(first: 100, after: $after, excludeUserLinked: true) {
        nodes { number repository { nameWithOwner } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

const MAX_LINKED_ISSUE_PAGES = 10;

type ResolverFailure = Extract<ResolverAnswer<never>, { readonly ok: false }>;

export interface ResolverSourceOptions {
    readonly http: GitHubHttpClient;
    readonly repository: RepositoryRef;
    /**
     * The repository's reviewed configuration — the label mapping
     * `openAssignments` projects each assignment's labels through, so a
     * capability receives meanings and never a label string (contract.md §2).
     *
     * Required, not optional. Every composition on this line has a config in
     * hand where it builds this source, and an optional one would mean a
     * resolver silently answering with the meanings missing rather than a
     * compiler asking which config it should have used.
     */
    readonly config: RepositoryConfig;
}

/**
 * The reads `design/findings/endpoint-permission-matrix.md` records as
 * confirmed, each with the citation that confirmed it — `facts.ts`'s
 * `CONFIRMED_SWEEP_READS`, for the resolver surface.
 *
 * `openAssignments` is here under the list-issues row: the endpoint is
 * confirmed with its link-header paging, and a query FILTER on a confirmed
 * endpoint is already treated as inside that row — the sweep sends `state=open`
 * against it with no citation of its own. What is not separately evidenced is
 * how GitHub matches `assignee` (exact login, case), which is why the reader
 * below re-checks every returned item's assignee list rather than trusting the
 * filter.
 *
 * TWO ARE ABSENT, and both are implemented below and never sent.
 * `commitAttestations` reads `GET /repos/{o}/{r}/pulls/{n}/commits`, and
 * `assigneesOf` reads `GET /repos/{o}/{r}/issues/{n}` — the matrix confirms
 * `GET /repos/{o}/{r}/issues`, the LIST, which is a different endpoint and
 * cannot answer one issue. A capability shows the check as undetermined rather
 * than judging a contributor from a call nobody has evidence the App may make.
 */
export const CONFIRMED_RESOLVER_READS = [
    // GraphQL `closingIssuesReferences` — Issues R — `2026-08-29T20-51-00.386Z#same-repository`
    "linkedIssues",
    // No call: GitHub gives every App actor the `[bot]` suffix.
    "isAutomationActor",
    // `GET /repos/{o}/{r}/pulls/{n}` — Pull requests R — `2026-07-23T19-41-18-911Z#3`
    "mergeability",
    // `GET /repos/{o}/{r}/issues` — Issues R — `2026-07-23T19-36-29-346Z#1–6`
    "openAssignments",
] as const satisfies readonly ResolverName[];

/** One of `CONFIRMED_RESOLVER_READS` — a name the dispatch below must answer. */
type ConfirmedRead = (typeof CONFIRMED_RESOLVER_READS)[number];

function isConfirmedRead(query: ResolverName): query is ConfirmedRead {
    return (CONFIRMED_RESOLVER_READS as readonly ResolverName[]).includes(query);
}

/** GitHub's maximum, so one question costs as few calls as it can. */
const PAGE_SIZE = 100;

/** How many pages one list read may walk before the honest answer is that nobody read it. */
const MAX_LIST_PAGES = 10;

/** GitHub's own words reach an operator verbatim, so they are kept short. */
const QUOTED_HEADER_LIMIT = 40;

const unavailable = (detail: string): ResolverFailure => ({
    ok: false,
    reason: "unavailable",
    detail,
});

const rateLimited = (detail: string): ResolverFailure => ({
    ok: false,
    reason: "rateLimited",
    detail,
});

/**
 * A failed call as a resolver answer.
 *
 * The `reason` is the capability's half of this and stays coarse — a
 * capability can act on "rate limited" and on nothing finer. The `detail` is
 * the operator's half, and the three rate classes are three different
 * problems: an hourly budget spent, a burst that must slow down, and a wait
 * signal nobody could read. The adapter has already waited whatever was worth
 * waiting, so what arrives here is what an operator must decide about.
 */
function httpFailure(outcome: GitHubFailure): ResolverFailure {
    const failure = outcome.failure;
    switch (failure.kind) {
        case "permissionMissing":
            return { ok: false, reason: "noPermission", detail: "GitHub denied the query" };
        case "primaryExhausted":
            return rateLimited(
                "GitHub primary rate limit reached; the budget resets at " +
                    (failure.resetAt ?? "an instant GitHub did not report"),
            );
        case "secondaryLimit":
            return rateLimited(
                failure.retryAfterSeconds === undefined
                    ? "GitHub secondary rate limit reached, with no retry-after to wait on"
                    : `GitHub secondary rate limit reached; retry-after ${String(failure.retryAfterSeconds)}s`,
            );
        case "rateLimitResponseUnusable":
            return rateLimited(
                `GitHub rate limit reached; ${failure.headerName} ` +
                    `"${failure.headerValue.slice(0, QUOTED_HEADER_LIMIT)}" is ${failure.reason}`,
            );
        default:
            return unavailable(`GitHub query failed: ${describeFailure(failure)}`);
    }
}

function graphqlFailure(response: GitHubSuccess, errors: readonly unknown[]): ResolverFailure {
    const types = errors.map((error) => field(error, "type"));
    if (
        response.headers["x-ratelimit-remaining"] === "0" ||
        response.headers["retry-after"] !== undefined ||
        types.includes("RATE_LIMITED")
    ) {
        return { ok: false, reason: "rateLimited", detail: "GitHub GraphQL rate limit reached" };
    }
    if (types.includes("FORBIDDEN")) {
        return { ok: false, reason: "noPermission", detail: "GitHub denied the GraphQL query" };
    }
    return unavailable("GitHub GraphQL returned errors");
}

interface LinkedIssuesPage {
    readonly issues: readonly ItemRef[];
    readonly nextCursor: string | null;
}

function parsePage(
    response: GitHubSuccess,
    repository: RepositoryRef,
    number: number,
): { readonly ok: true; readonly page: LinkedIssuesPage } | ResolverFailure {
    const root = jsonRecordOf(response.body);
    if (root === null) return unavailable("GitHub returned malformed linked-issue data");

    const errors = field(root, "errors");
    if (errors !== undefined) {
        if (!Array.isArray(errors)) return unavailable("GitHub returned malformed GraphQL errors");
        if (errors.length > 0) return graphqlFailure(response, errors);
    }

    const returnedRepository = field(field(root, "data"), "repository");
    const pullRequest = field(returnedRepository, "pullRequest");
    const connection = field(pullRequest, "closingIssuesReferences");
    const nodes = field(connection, "nodes");
    const pageInfo = field(connection, "pageInfo");
    const hasNextPage = field(pageInfo, "hasNextPage");
    const endCursor = field(pageInfo, "endCursor");
    const expectedRepository = `${repository.owner}/${repository.repo}`.toLowerCase();

    if (
        typeof field(returnedRepository, "nameWithOwner") !== "string" ||
        (field(returnedRepository, "nameWithOwner") as string).toLowerCase() !==
            expectedRepository ||
        field(pullRequest, "number") !== number ||
        !Array.isArray(nodes) ||
        typeof hasNextPage !== "boolean" ||
        (endCursor !== null && typeof endCursor !== "string")
    ) {
        return unavailable("GitHub returned malformed linked-issue data");
    }

    const issues: ItemRef[] = [];
    for (const node of nodes) {
        const issueNumber = field(node, "number");
        const nameWithOwner = field(field(node, "repository"), "nameWithOwner");
        if (
            typeof issueNumber !== "number" ||
            !Number.isSafeInteger(issueNumber) ||
            issueNumber < 1 ||
            typeof nameWithOwner !== "string"
        ) {
            return unavailable("GitHub returned malformed linked-issue data");
        }
        if (nameWithOwner.toLowerCase() === expectedRepository) {
            issues.push({ kind: "issue", number: issueNumber });
        }
    }

    if (hasNextPage && (typeof endCursor !== "string" || endCursor.length === 0)) {
        return unavailable("GitHub returned a missing linked-issue cursor");
    }
    return { ok: true, page: { issues, nextCursor: hasNextPage ? endCursor : null } };
}

async function linkedIssues(
    { http, repository }: ResolverSourceOptions,
    input: unknown,
): Promise<ResolverAnswer<readonly ItemRef[]>> {
    const item = field(input, "item");
    const number = field(item, "number");
    if (
        field(item, "kind") !== "pullRequest" ||
        typeof number !== "number" ||
        !Number.isSafeInteger(number) ||
        number < 1
    ) {
        return unavailable("linkedIssues requires a valid pull request item");
    }

    const issues: ItemRef[] = [];
    const cursors = new Set<string>();
    let after: string | null = null;
    for (let pageNumber = 1; pageNumber <= MAX_LINKED_ISSUE_PAGES; pageNumber += 1) {
        const outcome = await http.request({
            url: GITHUB_GRAPHQL_URL,
            method: "POST",
            body: JSON.stringify({
                operationName: "LinkedIssues",
                query: LINKED_ISSUES_QUERY,
                variables: { owner: repository.owner, repo: repository.repo, number, after },
            }),
        });
        if (!outcome.ok) return httpFailure(outcome);

        const parsed = parsePage(outcome, repository, number);
        if (!parsed.ok) return parsed;
        issues.push(...parsed.page.issues);
        const next = parsed.page.nextCursor;
        if (next === null) return { ok: true, value: issues };
        if (cursors.has(next)) return unavailable("GitHub repeated a linked-issue cursor");
        cursors.add(next);
        after = next;
    }
    return unavailable("GitHub linked-issue pagination exceeded 10 pages");
}

// ─── The item reads ──────────────────────────────────────────────────

/**
 * The readers below share one question — "which item is this about?" — and one
 * answer to a bad one. An input that does not name a plausible item is
 * `unavailable` rather than a throw, because a resolver is called from inside
 * a capability's own evaluation and a throw there kills the delivery.
 */
function itemNumber(input: unknown, kind: ItemRef["kind"]): number | null {
    const item = field(input, "item");
    const number = field(item, "number");
    return field(item, "kind") === kind &&
        typeof number === "number" &&
        Number.isSafeInteger(number) &&
        number >= 1
        ? number
        : null;
}

/**
 * GitHub's own ceiling on the commits endpoint. A pull request with more
 * commits than this cannot be answered at all: the API stops listing, and a
 * check that read 250 of 400 commits and said "all signed off" would be lying.
 */
const MAX_COMMITS = 250;

/** Enough pages to reach the ceiling, and not one more. */
const MAX_COMMIT_PAGES = Math.ceil(MAX_COMMITS / PAGE_SIZE);

/** Does this commit message carry a DCO trailer? */
function hasSignoff(message: string): boolean {
    return message.split("\n").some((line) => /^\s*Signed-off-by:\s*\S/i.test(line));
}

/** One entry of the commits list, or `null` when the shape is not GitHub's. */
function attestationOf(entry: unknown): CommitAttestation | null {
    const sha = field(entry, "sha");
    const commit = field(entry, "commit");
    const message = field(commit, "message");
    const parents = field(entry, "parents");
    if (typeof sha !== "string" || sha.length === 0 || typeof message !== "string") return null;
    if (!Array.isArray(parents)) return null;
    return {
        sha,
        // The subject line alone. The body is where a contributor pastes a
        // stack trace, and no check reads it.
        summary: message.split("\n")[0] ?? "",
        signedOff: hasSignoff(message),
        verified: field(field(commit, "verification"), "verified") === true,
        merge: parents.length > 1,
    };
}

/**
 * Every commit of a pull request, or the reason there is no complete answer.
 *
 * Exported although the gate refuses before reaching it, exactly as `facts.ts`
 * exports `readReview`: the reader is complete and tested, and confirming the
 * endpoint is one entry in `CONFIRMED_RESOLVER_READS` rather than a build.
 */
export async function readCommitAttestations(
    { http, repository }: ResolverSourceOptions,
    number: number,
): Promise<ResolverAnswer<readonly CommitAttestation[]>> {
    const base = `${repoPath(repository)}/pulls/${String(number)}/commits`;
    const commits: CommitAttestation[] = [];
    for (let page = 1; page <= MAX_COMMIT_PAGES; page += 1) {
        const outcome = await http.request({
            url: `${base}?per_page=${String(PAGE_SIZE)}&page=${String(page)}`,
            method: "GET",
        });
        if (!outcome.ok) return httpFailure(outcome);
        const entries = jsonArrayOf(outcome.body);
        if (entries === null) return unavailable("GitHub returned malformed commit data");
        for (const entry of entries) {
            const attestation = attestationOf(entry);
            if (attestation === null) return unavailable("GitHub returned malformed commit data");
            commits.push(attestation);
        }
        if (entries.length < PAGE_SIZE) break;
    }
    // A list AT the ceiling may be all of them or the first 250 of four
    // hundred, and nothing in the response says which — so it is no answer,
    // not a short one — unknown is not an answer
    // (`design/contracts/catalogue.md`).
    return commits.length >= MAX_COMMITS
        ? unavailable(
              `GitHub lists at most ${String(MAX_COMMITS)} commits per pull request, and this one reached that limit`,
          )
        : { ok: true, value: commits };
}

/**
 * Can GitHub merge this pull request cleanly?
 *
 * GitHub computes mergeability in the background and reports `null` while it
 * is still thinking — which is neither `true` nor `false` and must never be
 * read as either. A capability asking again later is the whole recovery.
 */
async function mergeability(
    { http, repository }: ResolverSourceOptions,
    input: unknown,
): Promise<ResolverAnswer<boolean>> {
    const number = itemNumber(input, "pullRequest");
    if (number === null) return unavailable("mergeability requires a valid pull request item");

    const outcome = await http.request({
        url: `${repoPath(repository)}/pulls/${String(number)}`,
        method: "GET",
    });
    if (!outcome.ok) return httpFailure(outcome);
    const body = jsonRecordOf(outcome.body);
    if (body === null) return unavailable("GitHub returned malformed pull request data");
    if (body["number"] !== number) {
        return unavailable("GitHub answered about a different pull request");
    }
    const mergeable = body["mergeable"];
    if (typeof mergeable !== "boolean") {
        return unavailable("GitHub has not finished computing whether this branch merges cleanly");
    }
    return { ok: true, value: mergeable };
}

/**
 * The logins assigned to one item. Unpaged on purpose: GitHub caps assignees
 * at ten and returns them all on the item itself, so a page-walk would be a
 * second call for a list that cannot have a second page.
 *
 * Exported and unreachable for the same reason `readCommitAttestations` is —
 * `GET /repos/{o}/{r}/issues/{n}` is not a row in the matrix.
 */
export async function readAssigneesOf(
    { http, repository }: ResolverSourceOptions,
    number: number,
): Promise<ResolverAnswer<readonly string[]>> {
    const outcome = await http.request({
        url: `${repoPath(repository)}/issues/${String(number)}`,
        method: "GET",
    });
    if (!outcome.ok) return httpFailure(outcome);
    const body = jsonRecordOf(outcome.body);
    if (body === null) return unavailable("GitHub returned malformed issue data");
    if (body["number"] !== number) return unavailable("GitHub answered about a different issue");

    const assignees = body["assignees"];
    if (!Array.isArray(assignees)) return unavailable("GitHub returned malformed issue data");
    const logins: string[] = [];
    for (const assignee of assignees) {
        const login = field(assignee, "login");
        if (typeof login !== "string" || login.length === 0) {
            return unavailable("GitHub returned malformed issue data");
        }
        logins.push(login);
    }
    return { ok: true, value: logins };
}

/**
 * Every entry of the filtered open-issue list, or the reason there is no
 * complete answer — the sweep's `allPages` rule, one resolver over.
 *
 * A partial walk is a WRONG answer here, not a smaller one, because the caller
 * is about to compare the count to a cap. So a successor GitHub advertised
 * without naming the last page, and a list longer than the walk, are both
 * failures rather than what was read so far.
 */
async function assignedPages(
    http: GitHubHttpClient,
    repository: RepositoryRef,
    login: string,
): Promise<{ readonly ok: true; readonly entries: readonly unknown[] } | ResolverFailure> {
    const url = `${repoPath(repository)}/issues`;
    const entries: unknown[] = [];
    let lastPage = 1;
    for (let page = 1; page <= MAX_LIST_PAGES; page += 1) {
        const outcome = await http.request({
            url:
                `${url}?per_page=${String(PAGE_SIZE)}&page=${String(page)}` +
                `&state=open&assignee=${encodeURIComponent(login)}`,
            method: "GET",
        });
        if (!outcome.ok) return httpFailure(outcome);
        const read = jsonArrayOf(outcome.body);
        if (read === null) return unavailable("GitHub returned malformed assignment data");
        entries.push(...read);
        if (page === 1) {
            const link = outcome.headers["link"];
            const named = lastPageFromLink(link);
            if (named === null) {
                return link !== undefined && link.includes('rel="next"')
                    ? unavailable(
                          "GitHub advertised a next assignment page without naming the last",
                      )
                    : { ok: true, entries };
            }
            lastPage = named;
        }
        if (page >= lastPage) return { ok: true, entries };
    }
    return unavailable(`GitHub assignment pagination exceeded ${String(MAX_LIST_PAGES)} pages`);
}

/**
 * Every open issue in this repository one login is assigned to, each with the
 * meanings its labels projected to.
 *
 * The filter is `assignee=` on the confirmed list endpoint, and the answer is
 * re-checked rather than trusted: every returned item must actually carry the
 * login on its assignees, and a pull request that arrives in the same list is
 * dropped — an assignment is an issue claim, and a pull request counted toward
 * an issue cap would be arithmetic nobody asked for.
 *
 * A partial walk is a WRONG answer, not a smaller one, because the caller is
 * about to compare it to a cap. So an unreadable row, an unnamed last page and
 * an over-long list are all failures.
 */
async function openAssignments(
    { http, repository, config }: ResolverSourceOptions,
    input: unknown,
): Promise<ResolverAnswer<ResolverOutput<"openAssignments">>> {
    const login = field(input, "login");
    if (typeof login !== "string" || login.length === 0) {
        return unavailable("openAssignments requires a valid login");
    }

    const listed = await assignedPages(http, repository, login);
    if (!listed.ok) return listed;

    const wanted = login.toLowerCase();
    const assignments: { readonly item: ItemRef; readonly meanings: readonly MappableMeaning[] }[] =
        [];
    for (const entry of listed.entries) {
        const number = field(entry, "number");
        const labels = field(entry, "labels");
        const assignees = field(entry, "assignees");
        if (
            typeof number !== "number" ||
            !Number.isSafeInteger(number) ||
            number < 1 ||
            !Array.isArray(labels) ||
            !Array.isArray(assignees)
        ) {
            return unavailable("GitHub returned malformed assignment data");
        }
        if (field(entry, "pull_request") !== undefined) continue;

        const names: string[] = [];
        for (const label of labels) {
            const name = field(label, "name");
            if (typeof name !== "string") {
                return unavailable("GitHub returned malformed assignment data");
            }
            names.push(name);
        }
        // Read every login before judging any: an entry whose shape is not
        // GitHub's must REFUSE, not fail to match. A `some` that skipped it
        // would answer a shorter list, which is the one thing this file may
        // never do.
        const holders: string[] = [];
        for (const assignee of assignees) {
            const each = field(assignee, "login");
            if (typeof each !== "string") {
                return unavailable("GitHub returned malformed assignment data");
            }
            holders.push(each.toLowerCase());
        }
        if (!holders.includes(wanted)) continue;
        assignments.push({
            item: { kind: "issue", number },
            meanings: meaningsOfLabels(config, names),
        });
    }
    return { ok: true, value: assignments };
}

/**
 * GitHub gives every App actor the `[bot]` suffix, so no call is needed — and
 * the suffix itself is core's observed fact, not this file's.
 */
function isAutomationActor(input: unknown): ResolverAnswer<boolean> {
    const login = field(input, "login");
    return typeof login === "string" && login.length > 0
        ? { ok: true, value: isAutomationLogin(login) }
        : unavailable("isAutomationActor requires a valid login");
}

export function createResolverSource(options: ResolverSourceOptions): ResolverSource {
    // Exhaustive, with no default arm: a name added to RESOLVER_NAMES leaves
    // this switch able to return undefined, which the declared type refuses.
    // Adding the resolver is then a compile error, not a silent inheritance
    // of whichever answer happened to sit last.
    const resolve = async (
        query: ResolverName,
        input: unknown,
    ): Promise<ResolverAnswer<unknown>> => {
        // The matrix gate, before the dispatch: an unconfirmed read is
        // implemented and not sent, so a capability is told nobody could
        // answer rather than acting on evidence nobody may gather. Adding a
        // name to `CONFIRMED_RESOLVER_READS` makes the switch non-exhaustive,
        // so the compiler asks for the arm rather than a maintainer
        // remembering to write one.
        if (!isConfirmedRead(query)) {
            return unavailable(
                `"${query}" reads an endpoint the permission matrix has not confirmed`,
            );
        }
        switch (query) {
            case "linkedIssues":
                return linkedIssues(options, input);
            case "isAutomationActor":
                return isAutomationActor(input);
            case "mergeability":
                return mergeability(options, input);
            case "openAssignments":
                return openAssignments(options, input);
        }
    };
    // The one erasure: `ResolverSource` ties each name to its own output
    // type, and a body that dispatches at runtime cannot prove that pairing
    // per call. The switch above is what makes the pairing true.
    return resolve as ResolverSource;
}
