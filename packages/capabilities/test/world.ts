/**
 * What remains of the probe world after D92 3(c): the engine owns the
 * platform wiring (`decide()` replaced `runEnabled`, and the engine matrix
 * replaced the harness matrix), so this file keeps only the test
 * conveniences that were never platform-shaped — a config builder and the
 * smallest-block helper it is built on, the subset enumerator, and the
 * fact-record builders.
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

import { CAPABILITIES } from "../src/index.js";
import {
    carriesFactGroup,
    describeSpec,
    FACT_GROUPS,
    parseConfig,
    producerReads,
    UNREAD,
    type FactGroup,
    type AdmittedCapability,
    type FactKind,
    type Facts,
    type FieldDescription,
    type GroupsReadBy,
    type ProducerName,
    type RepositoryConfig,
    type SettingsView,
    type Spec,
    type Unread,
} from "@hiero-hackers/automation-core";

/**
 * The shipped declaration of one name, which is how a suite admits it.
 *
 * `parseConfig` reads each block against the spec that admitted it (C1), so a
 * fixture admitting a name has to admit the real capability or it would be
 * proving the settings against a schema nobody ships. A name outside the
 * registry throws here rather than quietly admitting nothing.
 */
function shipped(name: string): AdmittedCapability {
    const found = CAPABILITIES.find(({ declaration }) => declaration.name === name);
    if (found === undefined) throw new Error(`no shipped capability named "${name}"`);
    return found.declaration;
}

/** The three meanings a repository maps unless a suite asks for others. */
const LABELS: Readonly<Record<string, string>> = {
    awaitingTriage: "status: triage",
    inProgress: "status: in progress",
    blocked: "blocked",
};

/**
 * The principal a probe document declares when the suite named none.
 *
 * A spec may REQUIRE a principal, and a name is only a principal because the
 * document declared it — so a document that declares nobody has no valid block
 * to offer such a capability at all. One declared name is what makes the
 * smallest block below buildable without every suite knowing it.
 */
const PRINCIPALS: Readonly<Record<string, string>> = {
    maintainerTeam: "hiero-hackers/maintainers",
};

/**
 * The names a document offers a spec: its mapped families and its principals.
 *
 * The defaults are `configEnabling`'s own, so a suite that builds a block for
 * the default document and then enables it reads one answer, not two.
 */
export function namesOffered(
    mappings: Readonly<Record<string, unknown>> = { labels: LABELS },
    principals: Readonly<Record<string, string>> = PRINCIPALS,
): SettingsView {
    const family = (name: string): readonly string[] => {
        const written = mappings[name];
        return typeof written === "object" && written !== null ? Object.keys(written) : [];
    };
    return {
        mapped: {
            labels: family("labels"),
            commands: family("commands"),
            skills: family("skills"),
            alerts: family("alerts"),
        },
        principals: Object.keys(principals),
    };
}

/**
 * The smallest value one REQUIRED field admits.
 *
 * Only the kinds whose `absent` can be `problem` have one, which is why the
 * last arm is a throw rather than a value: a constructor that grows a required
 * form and is not named here would otherwise be answered with `undefined`, and
 * the parser's complaint would name the maintainer's key rather than this
 * helper.
 */
function smallestValue(key: string, field: FieldDescription, names: SettingsView): unknown {
    switch (field.kind) {
        case "principal":
            return names.principals[0];
        case "oneOf":
            return field.values?.[0];
        case "text":
            return "x";
        case "duration":
            return "1h";
        case "count":
            return 0;
        default:
            throw new Error(`no smallest value for a required "${field.kind}" at "${key}"`);
    }
}

/** One level of a described spec, and the levels an absent key still reads. */
function smallestIn(
    described: Readonly<Record<string, FieldDescription>>,
    names: SettingsView,
): Record<string, unknown> {
    const written: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(described)) {
        if (field.kind === "section") {
            const inner = smallestIn(field.fields ?? {}, names);
            if (Object.keys(inner).length > 0) written[key] = inner;
            continue;
        }
        if (field.absent === "problem") written[key] = smallestValue(key, field, names);
    }
    return written;
}

/**
 * The smallest settings block a spec accepts: every key whose absence is a
 * PROBLEM, at the smallest value its kind admits, and nothing else.
 *
 * A spec with a required key has no empty block, so a fixture that configures
 * every shipped capability with `enabled` and nothing else stops building the
 * day one ships a required setting — and the P3 matrix is exactly that
 * fixture. Read
 * off `describeSpec`, the spec's own account of itself, so the answer moves
 * with the spec rather than with a fixture nobody would think to edit.
 *
 * `names` is `readSettings`'s own second parameter, so the block is built from
 * the names it will be judged against. A required `principal` resolves to the
 * FIRST name the document declares, which is also how this says which
 * principals a document must declare: one that declares none cannot satisfy a
 * required principal, and the parser says so at the maintainer's own path.
 *
 * A `section` is walked whether or not it is written, because an absent one
 * still reads every field it holds. Every other group empties or parks when it
 * is absent (`packages/core/src/capability/settings.ts`), so no required key
 * can hide inside one.
 */
export function smallestValidSettings(
    fields: Spec,
    names: SettingsView,
): Readonly<Record<string, unknown>> {
    return smallestIn(describeSpec(fields), names);
}

/** One level of a described spec, with everything a file can state stated. */
function fullestIn(
    described: Readonly<Record<string, FieldDescription>>,
    names: SettingsView,
): Record<string, unknown> {
    const written: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(described)) {
        if (field.kind === "block") {
            written[key] = { enabled: true, ...fullestIn(field.fields ?? {}, names) };
        } else if (field.kind === "section" || field.kind === "closed") {
            written[key] = fullestIn(field.fields ?? {}, names);
        } else if (field.absent === "problem") {
            written[key] = smallestValue(key, field, names);
        } else if (field.kind === "flag") {
            // A flag is a switch, and "fullest" throws every switch: a
            // capability whose comment is behind `announce: true` posts it here.
            written[key] = true;
        } else if (field.default !== undefined) {
            written[key] = field.default;
        }
    }
    return written;
}

/**
 * The settings block that switches a spec on: every block consented to, every
 * flag `true`, every required key at the smallest value its kind admits, every
 * other key at its own default.
 *
 * A capability whose work is behind an opt-in block does nothing at all under
 * `smallestValidSettings`, and a suite wanting it to decide something used to
 * keep a hand-written map of blocks to enable — a map nobody edits when a
 * capability grows its first one, which is exactly when the suite stops
 * measuring anything. This is that map derived from the spec instead.
 *
 * Absent is the default for the three kinds nothing is written for: an open
 * mapping's keys are the repository's own and no fixture can invent one, a
 * list reads as no entries, and a key that may be left out reads as `null`.
 */
export function fullestValidSettings(
    fields: Spec,
    names: SettingsView,
): Readonly<Record<string, unknown>> {
    return fullestIn(describeSpec(fields), names);
}

/**
 * A repository configuration enabling exactly the named capabilities.
 *
 * `mappings` is a parameter because a capability's rules can depend on WHICH
 * meanings are mapped, not only on its own settings: inactivity's label reason
 * demands `needsRevision`, which the default three do not include. Its entries
 * are `unknown` rather than strings because the value goes to `parseConfig`
 * unread, and narrowing it here would only be this fixture restating a schema
 * it does not own.
 *
 * `principals` is a parameter for the same reason: a settings field may name
 * one (`notify:`), and a document declaring none can only ever report the
 * name as undeclared.
 *
 * Every admitted block starts at `smallestValidSettings` rather than at `{}`,
 * enabled or not, because the parser reads a DISABLED capability's block too
 * (D84). That is what lets a capability with a required setting join the P3
 * matrix on its registry line alone: the fixture already writes the one key,
 * and `extra` still overrides anything a suite wants to state itself.
 */
export function configEnabling(
    names: readonly string[],
    known: readonly string[],
    extra: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {},
    mappings: Readonly<Record<string, unknown>> = { labels: LABELS },
    principals: Readonly<Record<string, string>> = PRINCIPALS,
): RepositoryConfig {
    const offered = namesOffered(mappings, principals);
    const capabilities: Record<string, unknown> = {};
    for (const name of known) {
        // Flat, as a maintainer writes it: consent, then the capability's own
        // keys beside it.
        capabilities[name] = {
            enabled: names.includes(name),
            ...smallestValidSettings(shipped(name).settings, offered),
            ...extra[name],
        };
    }
    const result = parseConfig(
        {
            schemaVersion: 2,
            mode: "active",
            capabilities,
            mappings,
            principals,
        },
        { revision: "rev-1", knownCapabilities: known.map(shipped) },
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
            reapableSince: {
                needsRevision: new Date("2026-07-01T00:00:00.000Z"),
                changesRequested: new Date("2026-07-01T00:00:00.000Z"),
                draft: new Date("2026-07-01T00:00:00.000Z"),
            },
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
