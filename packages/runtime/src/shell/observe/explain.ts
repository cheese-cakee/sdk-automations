/**
 * `pnpm shell:explain`: one effect's facts and where it stands, or one item's effects and decisions.
 * A read, printed as plain lines — never a log line, and it changes nothing (D163).
 */

import { existsSync } from "node:fs";
import type { ItemRef, RepositoryRef } from "@hiero-hackers/automation-core";
import { fold, Store, type Decision, type Fact, type LedgerState } from "../../store/index.js";
import { storeFile } from "../paths.js";

/** What one question came to: the lines to print, and whether the store held an answer. */
export interface Explanation {
    readonly found: boolean;
    readonly lines: readonly string[];
}

/** How a column that holds nothing is spelled. */
const NOTHING = "-";

const column = (value: string | number | null): string =>
    value === null ? NOTHING : String(value);

const spelled = (item: ItemRef): string => `${item.kind}#${String(item.number)}`;

const spelledRepository = (repository: RepositoryRef): string =>
    `${repository.owner}/${repository.repo}`;

/** `issue#40` or `pullRequest#40`, and nothing else. */
function itemOf(spec: string): ItemRef | null {
    const named = /^(issue|pullRequest)#(\d+)$/.exec(spec);
    return named === null ? null : { kind: named[1] as ItemRef["kind"], number: Number(named[2]) };
}

/** `owner/repo`, both halves spelled and neither holding a slash. */
function repositoryOf(spec: string): RepositoryRef | null {
    const halves = /^([^/\s]+)\/([^/\s]+)$/.exec(spec);
    return halves === null ? null : { owner: halves[1] as string, repo: halves[2] as string };
}

/** The plan length no row holds: the longest call this effect ever named. */
const planOf = (facts: readonly Fact[]): number =>
    facts.reduce((longest, fact) => Math.max(longest, fact.seq), 0);

/** One fact: its place in the effect's order, then what it says. */
function factLine(place: number, fact: Fact): string {
    return [
        place,
        fact.at,
        fact.kind,
        fact.seq,
        column(fact.verb),
        column(fact.login),
        column(fact.code),
        column(fact.detail),
    ].join("  ");
}

/** Where the effect stands. `≥` carries the assumption: the plan is the longest seq seen. */
function stateLine(state: LedgerState, plan: number): string {
    const of = `of ≥${String(plan)}`;
    switch (state.kind) {
        case "neverStarted":
            return "state: neverStarted";
        case "open":
            return `state: open (seq ${String(state.seq)} ${of}, attempts ${String(state.attempts)})`;
        case "resumable":
            return `state: resumable (next seq ${String(state.nextSeq)} ${of})`;
        case "settled":
            return `state: settled ${state.how} (seq ${String(state.seq)} ${of})`;
        case "inconsistent":
            return `state: inconsistent (${state.detail})`;
    }
}

function decisionLine(decision: Decision): string {
    return [
        "decision",
        decision.at,
        decision.source,
        decision.passId,
        decision.capability,
        decision.verdict,
        column(decision.code),
        column(decision.detail),
        column(decision.effectId),
    ].join("  ");
}

/** One effect's history in ledger order, then the fold over it. */
export function explainEffect(store: Store, effectId: string): Explanation {
    const facts = store.ledger.factsOf(effectId);
    if (facts.length === 0) {
        return { found: false, lines: [`no facts for effect "${effectId}"`] };
    }
    const plan = planOf(facts);
    return {
        found: true,
        lines: [
            `effect ${effectId}`,
            ...facts.map((fact, place) => factLine(place + 1, fact)),
            stateLine(fold(facts, plan), plan),
        ],
    };
}

/** Every effect with a fact on one item and where each stands, then its decisions, newest first. */
export function explainItem(store: Store, repository: RepositoryRef, item: ItemRef): Explanation {
    const effects = store.ledger.effectsOn(repository, item);
    const decisions = [...store.ledger.decisionsOn(repository, item)].reverse();
    return {
        found: effects.length > 0 || decisions.length > 0,
        lines: [
            spelled(item),
            ...effects.map((effectId) => {
                const facts = store.ledger.factsOf(effectId);
                const plan = planOf(facts);
                const state = stateLine(fold(facts, plan), plan);
                return `effect ${effectId}  ${spelledRepository(repository)}  ${state}`;
            }),
            ...decisions.map(decisionLine),
        ],
    };
}

const USAGE =
    "usage: pnpm shell:explain <effect-id> | pnpm shell:explain --item issue#40 --repo owner/repo";

/** The two questions the command asks: one effect, or one item of one repository (D169). */
type Question =
    | { readonly kind: "effect"; readonly effectId: string }
    | { readonly kind: "item"; readonly repository: RepositoryRef; readonly item: ItemRef };

/** What the arguments ask, or `null` where they ask nothing this command answers. */
function questionOf(argv: readonly string[]): Question | null {
    // pnpm forwards the root script's `--` separator as an argument; it asks nothing.

    const [first, second, third, fourth] = argv[0] === "--" ? argv.slice(1) : argv;
    if (first === undefined || first === "") return null;
    if (first !== "--item") return { kind: "effect", effectId: first };
    const item = itemOf(second ?? "");
    const repository = third === "--repo" ? repositoryOf(fourth ?? "") : null;
    if (item === null || repository === null) return null;
    return { kind: "item", repository, item };
}

/** The command: which store to open, and which of the two questions to ask it. */
export function explain(
    argv: readonly string[],
    env: Readonly<Partial<Record<string, string>>> = process.env,
): Explanation {
    const question = questionOf(argv);
    if (question === null) return { found: false, lines: [USAGE] };
    const path = storeFile(env);
    if (!existsSync(path)) return { found: false, lines: [`no store at ${path}`] };
    const store = new Store(path);
    try {
        return question.kind === "effect"
            ? explainEffect(store, question.effectId)
            : explainItem(store, question.repository, question.item);
    } finally {
        store.close();
    }
}
