/**
 * What remains of the probe world after D92 3(c): the engine owns the
 * platform wiring (`decide()` replaced `runEnabled`, and the engine matrix
 * replaced the harness matrix), so this file keeps only the test
 * conveniences that were never platform-shaped — a config builder, the
 * subset enumerator, and the fact-record builders.
 *
 * ONE BUILDER, and it takes a producer: `recordFrom` reads that producer's row
 * in core's `PRODUCERS` and fills exactly the groups the row names, marking the
 * rest `UNREAD`. A suite naming a producer is therefore making the platform's
 * own claim about what that producer reads, and a row that changes moves every
 * fixture with it rather than leaving four hand-written records behind. The
 * four named builders below are thin wrappers, kept because which producer a
 * suite reaches for IS the claim it is making and `recordFrom("sweep", …)`
 * reads no better at a call site than `sweptIssue()`.
 */

import {
    carriesFactGroup,
    FACT_GROUPS,
    parseConfig,
    producerReads,
    UNREAD,
    type FactGroup,
    type FactKind,
    type Facts,
    type GroupsReadBy,
    type ProducerName,
    type RepositoryConfig,
    type Unread,
} from "@hiero-hackers/automation-core";

/** The three meanings a repository maps unless a suite asks for others. */
const LABELS: Readonly<Record<string, string>> = {
    awaitingTriage: "status: triage",
    inProgress: "status: in progress",
    blocked: "blocked",
};

/**
 * A repository configuration enabling exactly the named capabilities.
 *
 * `mappings` is a parameter because a capability's rules can depend on WHICH
 * meanings are mapped, not only on its own settings: inactivity's label reason
 * demands `needsRevision`, which the default three do not include. Its entries
 * are `unknown` rather than strings because the OPEN families spell a meaning
 * as an object (`{ label: "P0-🔥" }`) — the value goes to `parseConfig`
 * unread, and narrowing it here would only be this fixture restating a schema
 * it does not own.
 *
 * `principals` is a parameter for the same reason: a settings field may name
 * one (`notify:`), and a document declaring none can only ever report the
 * name as undeclared.
 */
export function configEnabling(
    names: readonly string[],
    known: readonly string[],
    extra: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {},
    mappings: Readonly<Record<string, unknown>> = { labels: LABELS },
    principals: Readonly<Record<string, string>> = {},
): RepositoryConfig {
    const capabilities: Record<string, unknown> = {};
    for (const name of known) {
        capabilities[name] = {
            enabled: names.includes(name),
            settings: extra[name] ?? {},
        };
    }
    const result = parseConfig(
        {
            schemaVersion: 1,
            mode: "active",
            capabilities,
            mappings,
            principals,
        },
        { revision: "rev-1", knownCapabilities: known },
    );
    if (!result.ok) {
        throw new Error(`probe config invalid: ${result.errors.map((e) => e.message).join("; ")}`);
    }
    return result.config;
}

/** Every subset of the given names, smallest first. */
export function subsets<T>(items: readonly T[]): readonly (readonly T[])[] {
    const out: T[][] = [[]];
    for (const item of items) {
        for (const existing of [...out]) out.push([...existing, item]);
    }
    return out.sort((a, b) => a.length - b.length);
}

/**
 * A record exactly as producer `P` makes one for kind `K`: every group its
 * registry row names is read, every other one is `Unread`.
 *
 * The mirror of the boundary's `FactsFor` from the other side. A builder
 * returning the wide `Facts` union could not be handed to any `evaluate` at
 * all — the view a declaration earns names each group exactly once, read or
 * unread, which is the guarantee doing its job.
 */
type RecordFrom<P extends ProducerName, K extends FactKind> = {
    readonly [Key in keyof Extract<Facts, { kind: K }>]: Key extends FactGroup
        ? Key extends GroupsReadBy<P, K>
            ? Exclude<Extract<Facts, { kind: K }>[Key], Unread>
            : Unread
        : Extract<Facts, { kind: K }>[Key];
};

const AT = new Date("2026-08-03T09:00:00.000Z");
const REPO = { owner: "hiero-hackers", repo: "sandbox" } as const;

/** Open, unpositioned, unpaused — the position every record starts from. */
const OPEN = {
    kind: "position",
    state: { meaning: null, blocked: false, closedBy: null },
    ignored: [],
} as const;

/**
 * What each group holds when its producer read it — the smallest true answer,
 * so a suite that cares about a clock or a link states it as an override and
 * every other suite is not reading a value someone invented for it.
 */
const READ: { readonly [K in FactKind]: { readonly [G in FactGroup]?: unknown } } = {
    issue: {
        assignees: [],
        links: { openPullRequests: [] },
        // A read group with nothing in it: this delivery issued no command.
        // `UNREAD` would be the other thing entirely, which is the whole
        // point of the group (facts.md §2).
        command: null,
    },
    pullRequest: {
        assignees: [],
        links: { issues: [] },
        review: {
            changesRequested: false,
            reapableSince: new Date("2026-07-01T00:00:00.000Z"),
            lastCommitAt: null,
        },
        readiness: { draft: true },
    },
};

/** One number per producer and kind, so a suite holding several can tell them apart. */
const NUMBERS: Readonly<Record<string, number>> = {
    "issues/issue": 11,
    "pull_request/pullRequest": 12,
    "sweep/issue": 13,
    "sweep/pullRequest": 14,
    "issue_comment/issue": 15,
};

/**
 * One record as the named producer makes it.
 *
 * The single cast in this file, and what it stands on: the loop fills exactly
 * the groups `RecordFrom` types as read, because both read the same registry.
 * A group nobody enumerated would be a missing property rather than a wrong
 * one, and `FACT_GROUPS` is what stops that.
 */
export function recordFrom<P extends ProducerName, K extends FactKind>(
    producer: P,
    kind: K,
    over: Partial<RecordFrom<P, K>> = {},
): RecordFrom<P, K> {
    const groups: Record<string, unknown> = {};
    for (const group of FACT_GROUPS) {
        if (!carriesFactGroup(kind, group)) continue;
        groups[group] = producerReads(producer, kind, group) ? READ[kind][group] : UNREAD;
    }
    return {
        kind,
        repository: REPO,
        item: { kind, number: NUMBERS[`${producer}/${kind}`] ?? 1 },
        observedAt: AT,
        trigger: producer === "sweep" ? { kind: "sweep" } : { kind: "event", event: producer },
        author: "opener",
        // Nobody causes a sweep; a delivery has a sender. Neither is a group.
        actor: producer === "sweep" ? null : { login: "actor" },
        position: OPEN,
        alerts: { carried: [], arrived: [] },
        ...groups,
        ...over,
    } as RecordFrom<P, K>;
}

/** An issue as a webhook produces it: the projection read, every group unread. */
export function webhookIssue(
    over: Partial<RecordFrom<"issues", "issue">> = {},
): RecordFrom<"issues", "issue"> {
    return recordFrom("issues", "issue", over);
}

/** An issue as a sweep produces it: every group read. */
export function sweptIssue(
    over: Partial<RecordFrom<"sweep", "issue">> = {},
): RecordFrom<"sweep", "issue"> {
    return recordFrom("sweep", "issue", over);
}

/** A pull request as a webhook produces it — `review` unread with the rest. */
export function webhookPullRequest(
    over: Partial<RecordFrom<"pull_request", "pullRequest">> = {},
): RecordFrom<"pull_request", "pullRequest"> {
    return recordFrom("pull_request", "pullRequest", over);
}

/** A pull request as a sweep produces it: every group read. */
export function sweptPullRequest(
    over: Partial<RecordFrom<"sweep", "pullRequest">> = {},
): RecordFrom<"sweep", "pullRequest"> {
    return recordFrom("sweep", "pullRequest", over);
}

/**
 * One producer's record as one DECLARATION sees it — the erasure `decide()`
 * performs at the boundary (`facts as never`), done once here.
 *
 * `FactsFor` types every group a declaration did not name as `Unread` exactly,
 * so that a capability can do nothing with it. A producer's real record may
 * have read that group anyway — `pull_request` fills `readiness`, and
 * `prQuality` declares no need for it — and the two types are then not
 * assignable in either direction, although the value is right. A unit test
 * calling `evaluate` directly is the one place that meets it; the engine casts
 * for the same reason, at the same seam.
 */
export function asDeclared<F>(record: unknown): F {
    return record as F;
}

/** An issue as a comment delivery produces it: the command read, nothing else. */
export function commentedIssue(
    over: Partial<RecordFrom<"issue_comment", "issue">> = {},
): RecordFrom<"issue_comment", "issue"> {
    return recordFrom("issue_comment", "issue", over);
}
