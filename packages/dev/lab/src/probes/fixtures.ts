/**
 * The sandbox items a probe reads, pinned by number, with the state each must hold.
 * A fixture in another state refuses the run; it does not become a drift.
 */

/** What a fixture is, and so what checking it costs: an item is read, a login is not. */
export type FixtureKind = "pullRequest" | "issue" | "login" | "repository";

export interface Fixture {
    readonly kind: FixtureKind;
    readonly number?: number;
    readonly login?: string;
    readonly state?: "open" | "closed";
    readonly draft?: boolean;
}

/** Protocol 6.9's states, as `packages/dev/lab/protocols/6.9-sweep-and-check-reads.md` names them. */
export const FIXTURES = {
    PR_DRAFT: { kind: "pullRequest", number: 186, state: "open", draft: true },
    PR_READY: { kind: "pullRequest", number: 180, state: "open", draft: false },
    PR_REVIEW_REQUESTED: { kind: "pullRequest", number: 181, state: "open", draft: false },
    PR_CHANGES_REQUESTED: { kind: "pullRequest", number: 182, state: "open", draft: false },
    PR_COMMITS: { kind: "pullRequest", number: 183, state: "open", draft: false },
    ISSUE_ASSIGNED_MERGED: { kind: "issue", number: 184, state: "open" },
    ISSUE_ASSIGNED_NEW: { kind: "issue", number: 185, state: "open" },
    MERGED_LOGIN: { kind: "login", login: "exploreriii" },
    NEW_LOGIN: { kind: "login", login: "aceppaluni" },
    /** The repository itself, for the two reads that name no item. */
    REPOSITORY: { kind: "repository" },
} as const satisfies Readonly<Record<string, Fixture>>;

export type FixtureName = keyof typeof FIXTURES;

export const FIXTURE_NAMES = Object.keys(FIXTURES) as readonly FixtureName[];

/** One line naming a fixture and the state it must hold. */
export function describeFixture(name: FixtureName): string {
    const fixture: Fixture = FIXTURES[name];
    const held = [
        fixture.number === undefined ? undefined : `#${String(fixture.number)}`,
        fixture.login,
        fixture.state,
        fixture.draft === undefined ? undefined : `draft: ${String(fixture.draft)}`,
    ].filter((part): part is string => part !== undefined);
    return `${name} — ${[fixture.kind, held.join(", ")].filter(Boolean).join(" ")}`;
}
