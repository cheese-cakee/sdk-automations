/**
 * The judgements any capability makes over a fact record, and the vocabulary
 * every capability states them in.
 *
 * `catalogue.ts` says what a record CARRIES; this says what is true of one. The
 * first promotion's own count is why the file exists: three capabilities
 * re-derived "is this item open, paused, conflicted", "is this login a bot",
 * the idle-clock arithmetic and the mention-and-date spelling on their own, and
 * P3 forbids a capability importing a sibling — so the place to share is here.
 *
 * What this file owns: the three stops as predicates over `Facts`, the actor
 * filter, the two clocks and the arithmetic behind them, the meanings a
 * projection carried, and the words a warning is written in.
 *
 * What it does NOT own: SETTINGS of any kind — no threshold, no exemption, no
 * enabled block — and no capability's own words. A judgement here is true of a
 * record whoever reads it; the moment it needs a repository's number it belongs
 * back in the capability whose settings hold that number. `mentions` and `on`
 * are here because they are SPELLING, the same on every sentence; the sentences
 * themselves are each capability's.
 *
 * A capability imports these and never a sibling (P3).
 */

import type { MappableMeaning } from "../config/index.js";
import { observedMeaningsOf } from "../safety/index.js";
import {
    closureOf,
    ISSUE_EDGES,
    isPausedByProjection,
    PR_EDGES,
    type Edge,
    type TransitionCause,
} from "../workflow/index.js";
import type {
    AssigneeClock,
    Facts,
    PullRequestFacts,
    ResolverAnswer,
    ResolverInput,
    ResolverOutput,
    Unread,
} from "./catalogue.js";

// ─── The three stops ─────────────────────────────────────────────────

/**
 * A closed issue and a merged pull request have both left.
 *
 * Closure sits on both projection branches (D59) and `closureOf` reads
 * whichever one this record took, which is the whole reason this is a call
 * rather than a field read at each site.
 */
export function isOpen(facts: Facts): boolean {
    return closureOf(facts.position) === null;
}

/**
 * A paused item's clocks all stop — though WHETHER a pause exempts is the
 * repository's to say, so no capability may read this without also reading its
 * own exemption setting.
 *
 * An unmapped `blocked` is not a misconfiguration: no item can then carry the
 * meaning, so this is simply never true — and the general rules refuse every
 * write to a blocked item regardless.
 */
export function isPaused(facts: Facts): boolean {
    return isPausedByProjection(facts.position);
}

/**
 * A conflicted item has no position to judge, and the platform refuses it
 * anyway — `deriveWorld` establishes no precondition from a conflict, so acting
 * would produce a refusal rather than an effect.
 *
 * A boolean rather than a type predicate on purpose. A capability that only
 * STOPS on a conflict reads this; one that REPORTS the conflict has to name the
 * positions, and the narrowing that reaches them is the inline comparison —
 * which stays where it is until the stops leave `evaluate` altogether.
 */
export function isConflicted(facts: Facts): boolean {
    return facts.position.kind === "conflict";
}

/** Every mapped meaning the record's projection carried, both branches. */
export function meaningsOf(facts: Facts): readonly MappableMeaning[] {
    return observedMeaningsOf<MappableMeaning>(facts.position);
}

// ─── Moving an item ──────────────────────────────────────────────────

/**
 * The legal cause for moving this record's item to `meaning`, or `null` when
 * the map has no such edge from where the item stands.
 *
 * D5: a capability must never name a cause. "`needsRevision` on fail,
 * `needsReview` on pass" is what a design page says and what a reader expects
 * to write, and every spelling of it that names its own cause is refused
 * `transitionNotOnMap` from most positions — because the cause belongs to the
 * EDGE, and which edge is being walked depends on where the item is now, which
 * the design cannot know. So the capability names the destination and the
 * platform reads the cause off the map.
 *
 * `null` on three counts, and all three mean the same thing to a caller — do
 * not ask for this move: a conflicted item has no position to move FROM, the
 * profiles are entity-scoped so a pull-request meaning on an issue is not on
 * this item's map at all, and an edge the map does not draw is a move nobody
 * may make. A caller that wants to know WHY asks the projection, which it
 * already has.
 *
 * The FIRST cause of the edge, where an edge accepts more than one. Every
 * multi-cause edge in both profiles is one move with two names for it —
 * `lastContributorUnassigned` and `reclaimCompleted` both put an issue back to
 * `ready` — so any of them passes `screenIntent`, and picking a later one
 * would only mean the journal row said a less likely thing.
 */
export function moveTo(facts: Facts, meaning: MappableMeaning): TransitionCause | null {
    if (facts.position.kind === "conflict") return null;
    const from: string | null = facts.position.state.meaning;
    const edges: readonly Edge<string, TransitionCause>[] =
        facts.kind === "issue" ? ISSUE_EDGES : PR_EDGES;
    return edges.find((edge) => edge.from === from && edge.to === meaning)?.causes[0] ?? null;
}

// ─── Who is a person ─────────────────────────────────────────────────

/**
 * The one question `people` asks, and the whole of what it is handed.
 *
 * A capability's own `PlatformHandle` satisfies this exactly when its
 * declaration lists `isAutomationActor`: the handle's `resolve` is constrained
 * to the declared resolvers, so a declaration that never asked for the actor
 * lookup fails to match here and the call does not compile. That is P3's
 * isolation rule doing its own work — this file widens nothing.
 */
export interface ActorLookup {
    resolve(
        query: "isAutomationActor",
        input: ResolverInput<"isAutomationActor">,
    ): Promise<ResolverAnswer<ResolverOutput<"isAutomationActor">>>;
}

/**
 * The assignees a capability may act on: never a bot, and never a login the
 * actor lookup could not answer for.
 *
 * The cautious reading is the only safe one when the next step is destructive
 * (D51). A dropped login is named in no reminder either — a warning about an
 * assignment that will never be released would be a lie.
 */
export async function people(
    platform: ActorLookup,
    assignees: readonly AssigneeClock[],
): Promise<readonly AssigneeClock[]> {
    const found: AssigneeClock[] = [];
    for (const assignee of assignees) {
        const isBot = await platform.resolve("isAutomationActor", { login: assignee.login });
        if (!isBot.ok || isBot.value) continue;
        found.push(assignee);
    }
    return found;
}

// ─── The clocks ──────────────────────────────────────────────────────

/** One day, in milliseconds — the unit every clock and deadline is counted in. */
export const DAY_MS = 24 * 60 * 60 * 1000;

/** One clock: when the current run of idleness began, and how long it has run. */
export interface Clock {
    readonly idleSince: Date;
    readonly idleDays: number;
}

/** A pull request with the two groups its clock reads, both of them read. */
export interface PullRequestClockFacts {
    readonly assignees: Exclude<PullRequestFacts["assignees"], Unread>;
    readonly review: Exclude<PullRequestFacts["review"], Unread>;
}

/**
 * The clock's start: the state's own beginning, moved forward by any reset
 * that happened later. A reset before the start belongs to a previous run and
 * is ignored, which is why this is a maximum rather than a preference.
 */
function startedAt(base: Date, resets: readonly (Date | null)[]): Date {
    const newest = latestOf(resets);
    return newest !== null && newest.getTime() > base.getTime() ? newest : base;
}

function clockFrom(idleSince: Date, observedAt: Date): Clock {
    return {
        idleSince,
        idleDays: Math.floor((observedAt.getTime() - idleSince.getTime()) / DAY_MS),
    };
}

/** One assignee's own clock: their assignment, reset by their own `/working`. */
export function assigneeClock(assignee: AssigneeClock, observedAt: Date): Clock {
    return clockFrom(startedAt(assignee.assignedAt, [assignee.lastWorkingAt]), observedAt);
}

/**
 * A pull request's one clock: the mode it is in, reset by a commit or by a
 * `/working` from anyone on it.
 *
 * A pull request's clock is the pull request's, not any one assignee's, so
 * every assignee is a person on it — and a pull request with no assignees is
 * reset by commits alone.
 */
export function pullRequestClock(facts: PullRequestClockFacts, observedAt: Date): Clock {
    return clockFrom(
        startedAt(facts.review.reapableSince, [
            facts.review.lastCommitAt,
            ...facts.assignees.map((assignee) => assignee.lastWorkingAt),
        ]),
        observedAt,
    );
}

/** The newest of a set of activity instants, or `null` when the facts carry none. */
export function latestOf(instants: readonly (Date | null)[]): Date | null {
    let newest: Date | null = null;
    for (const instant of instants) {
        if (instant !== null && (newest === null || instant.getTime() > newest.getTime())) {
            newest = instant;
        }
    }
    return newest;
}

// ─── The words a warning is written in ───────────────────────────────

/** The people a sentence addresses, in the spelling GitHub notifies on. */
export const mentions = (logins: readonly string[]): string =>
    logins.map((login) => `@${login}`).join(", ");

/**
 * The characters that DO something where a capability quotes untrusted text:
 * links and images, emphasis, code spans, raw HTML and entities, tables,
 * strikethrough, headings. A backslash escapes every one of them in CommonMark,
 * so one mechanism covers the lot — including `<!--`, which is how a marker
 * would be smuggled in (`design/contracts/catalogue.md`).
 *
 * Ordinary sentence punctuation is deliberately absent: `.`, `:`, `-` and `+`
 * do nothing inside a line, and escaping them would make every quoted commit
 * message read like a shell script.
 */
const ACTIVE_MARKDOWN = /[\\`*_[\]()<>&|~#!]/g;

/** GitHub stops linking a mention when anything at all sits after the `@`. */
const ZERO_WIDTH_SPACE = "​";

/** How much of an untrusted line is worth quoting back at a reader. */
const QUOTED_LIMIT = 120;

/**
 * Untrusted text, rendered so that it says something and does nothing —
 * the catalogue's "what the platform will render" rule as a function.
 *
 * A commit message, a title and a display name are all written by whoever
 * opened the pull request, and a capability that interpolates one into a
 * managed comment is publishing an attacker's markdown under the App's name.
 * Four things happen here and each closes one route: the text becomes ONE line
 * (a newline escapes any list item or blockquote it was nested in), every
 * active markdown character is backslash-escaped (this is what neutralises
 * `<!-- hiero-automation:… -->` too), every `@` gains a zero-width space so no
 * mention notifies anybody, and the result is capped — a reader learns nothing
 * from the four-thousandth character of a commit subject.
 *
 * It lives here rather than in a capability because it is SPELLING, the same on
 * every sentence, and P3 forbids the second capability that needs it importing
 * the first.
 */
export function inert(text: string): string {
    const oneLine = text.replace(/\s+/gu, " ").trim();
    const capped = oneLine.length > QUOTED_LIMIT ? `${oneLine.slice(0, QUOTED_LIMIT)}…` : oneLine;
    return capped
        .replace(ACTIVE_MARKDOWN, (char) => `\\${char}`)
        .replaceAll("@", `@${ZERO_WIDTH_SPACE}`);
}

/** The date a warning names, in the designs' own spelling. */
export const on = (deadline: Date): string => `**${deadline.toISOString().slice(0, 10)}**`;

/**
 * The two sentences the platform keeps rather than posts (grace.md §1): what
 * cancels a plan, and how a maintainer undoes it once it happened.
 *
 * They are the same wherever a clock is the reason for an act, because the same
 * two things are true of every one of them: development activity is what stops
 * the clock, and the act is undone by putting the item back the way it was.
 */
export const CANCELLED_BY = "a commit or a /working comment";
export const REVERSES_WITH = "re-assign / reopen";
