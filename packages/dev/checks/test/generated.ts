/**
 * The contract tables of `design/contracts/catalogue.md`,
 * `design/contracts/facts.md` and `design/contracts/safety.md`, and the
 * capability table of `docs/capabilities.md`, rendered from the registries
 * that own them.
 *
 * The locks used to compare COLUMNS — a row list here, a permission there —
 * which left every cell no assertion reached free to drift, and left a red
 * lock with no instruction beyond "edit the table by hand until it matches".
 * Generating the whole table answers both: the document holds no fact the
 * code does not, and `pnpm contracts` is the fix.
 *
 * Two things the registries cannot give, so both are maps HERE and both are
 * mapped types over the code's own unions — a new operation, meaning or code
 * fails to compile until its entry follows (D76). The first is the desired
 * shape's field names and a resolver's input and output type names, which are
 * types and reach no runtime value. The second is the per-row sentence: a cell
 * that is prose is the one thing a generator cannot derive, so it lives here
 * where the review question is "is this sentence still true", asked once,
 * rather than in a document nothing compares.
 *
 * A table whose rows are all data keeps no sentence at all — the prose that
 * used to sit in a `Carries` column moved under the table, where review owns
 * it and no generator has to reproduce it.
 *
 * NOT generated: everything outside the markers. The prose around each table
 * is hand-written and stays that way, which is why the rewriter replaces
 * blocks rather than files.
 */

import {
    carriesFactGroup,
    FACT_GROUPS,
    FACT_KINDS,
    INTENT_OPERATIONS,
    MAPPABLE_MEANINGS,
    MEANING_FACTS,
    PRODUCER_NAMES,
    producerReads,
    producesKind,
    RESOLVER_NAMES,
    type DeclaredTrigger,
    type IntentOperation,
    type MappableMeaning,
    type MeaningFlow,
    type RecordOnlyCode,
    type RequiredMappings,
    type ResolverName,
    type SafetyRefusalCode,
} from "@hiero-hackers/automation-core";
import { shippedCapabilities } from "./capabilities.js";

// ─── One block of generated markdown ─────────────────────────────────

/** One table, and the marker pair it is written between. */
export interface GeneratedBlock {
    readonly name: string;
    readonly markdown: string;
}

/** One document and every generated block it holds, in document order. */
export interface GeneratedDocument {
    /** Repository-relative, so the runner and the locks name the file once. */
    readonly path: string;
    readonly blocks: readonly GeneratedBlock[];
}

const CLOSE = "<!-- /generated -->";

function open(name: string): string {
    return `<!-- generated: ${name} -->`;
}

/** The block as it must appear in the file, markers included. */
export function blockText(block: GeneratedBlock): string {
    return `${open(block.name)}\n${block.markdown}\n${CLOSE}`;
}

/**
 * What the file currently holds between one block's markers, or `null` when
 * the markers are not there — an absent block is a different fault from a
 * stale one, and the lock says so rather than reporting an empty diff.
 */
export function readGeneratedBlock(text: string, name: string): string | null {
    const start = text.indexOf(`${open(name)}\n`);
    if (start === -1) return null;
    const body = start + open(name).length + 1;
    const end = text.indexOf(`\n${CLOSE}`, body);
    return end === -1 ? null : text.slice(body, end);
}

/**
 * The document with every block's body replaced. Throws on a missing marker
 * pair: silently generating nothing is how a lock starts guarding an empty
 * region, and this runs from a command a human is watching.
 */
export function rewriteGeneratedBlocks(text: string, blocks: readonly GeneratedBlock[]): string {
    let rewritten = text;
    for (const block of blocks) {
        if (readGeneratedBlock(rewritten, block.name) === null) {
            throw new Error(`no "${block.name}" marker pair to rewrite`);
        }
        const start = rewritten.indexOf(`${open(block.name)}\n`);
        // `end` is the newline before the closing marker, and `blockText`
        // writes that marker back, so the tail resumes past it.
        const end = rewritten.indexOf(`\n${CLOSE}`, start) + 1 + CLOSE.length;
        rewritten = rewritten.slice(0, start) + blockText(block) + rewritten.slice(end);
    }
    return rewritten;
}

// ─── Rendering ───────────────────────────────────────────────────────

function code(value: string): string {
    return `\`${value}\``;
}

/**
 * The keys of a mapped type, still typed. The one narrowing in this file:
 * `Object.keys` widens to `string[]`, and a table built from a widened key
 * cannot index the map it came from.
 */
function keysOf<K extends string>(record: { readonly [P in K]: unknown }): readonly K[] {
    return Object.keys(record) as K[];
}

function codeList(values: readonly string[]): string {
    return values.map(code).join(", ");
}

/** A GitHub-flavoured table: header, rule, rows — the shape the docs use. */
function table(columns: readonly string[], rows: readonly (readonly string[])[]): string {
    const rule = `|${columns.map(() => "---|").join("")}`;
    const row = (cells: readonly string[]): string => `| ${cells.join(" | ")} |`;
    return [row(columns), rule, ...rows.map(row)].join("\n");
}

// ─── The catalogue's tables ──────────────────────────────────────────

/**
 * A resolver's input and output as a reader names them. Types, so no runtime
 * value carries them; the mapped type is what makes a new resolver fail to
 * compile here rather than quietly go undocumented.
 */
const RESOLVER_SIGNATURES: { readonly [Q in ResolverName]: { input: string; output: string } } = {
    linkedIssues: { input: "item", output: "ItemRef[]" },
    isAutomationActor: { input: "login", output: "boolean" },
    commitAttestations: { input: "item", output: "CommitAttestation[]" },
    mergeability: { input: "item", output: "boolean" },
    assigneesOf: { input: "item", output: "string[]" },
    openAssignments: { input: "login", output: "{ item, meanings }[]" },
};

/** The desired-outcome fields of each operation — `IntentCatalogue`'s keys. */
const DESIRED_FIELDS: { readonly [K in IntentOperation]: readonly string[] } = {
    postManagedComment: ["kind", "topic", "body", "mention"],
    applyMappedLabel: ["meaning", "cause"],
    assign: ["login"],
    unassign: ["login"],
    releaseAssignment: ["login"],
    closePullRequest: ["reason"],
    lockIssue: ["reason"],
    unlockIssue: ["reason"],
};

/** How the catalogue names each flow. `pause` applies to both flows (D28). */
const FLOW_NAMES: { readonly [F in MeaningFlow]: string } = {
    issue: "issue",
    pullRequest: "pull request",
    pause: "both",
};

/**
 * Whether a capability may set each meaning. `intent.ts` refuses `blocked` by
 * name, so this is not derivable from `MEANING_FACTS` — the one sentence in
 * the table, kept where a new meaning cannot be added without answering the
 * question (D79, D80).
 */
const MEANING_WRITABLE: { readonly [M in MappableMeaning]: string } = {
    awaitingTriage: "yes",
    ready: "yes",
    inProgress: "yes",
    needsReview: "yes",
    needsRevision: "yes",
    readyToMerge: "yes",
    blocked: "**no — human authority only (D79)**",
};

/** The four tables of `design/contracts/catalogue.md`, in document order. */
export function renderCatalogueTables(): readonly GeneratedBlock[] {
    return [
        {
            name: "facts",
            markdown: table(
                ["Kind", "Groups"],
                FACT_KINDS.map((kind) => [
                    code(kind),
                    codeList(FACT_GROUPS.filter((group) => carriesFactGroup(kind, group))),
                ]),
            ),
        },
        {
            name: "resolvers",
            markdown: table(
                ["Resolver", "Input", "Output"],
                RESOLVER_NAMES.map((name) => [
                    code(name),
                    code(RESOLVER_SIGNATURES[name].input),
                    code(RESOLVER_SIGNATURES[name].output),
                ]),
            ),
        },
        {
            name: "intents",
            markdown: table(
                ["Operation", "Desired", "Idempotency", "Action class", "Permission"],
                keysOf(INTENT_OPERATIONS).map((operation) => [
                    code(operation),
                    codeList(DESIRED_FIELDS[operation]),
                    code(INTENT_OPERATIONS[operation].idempotencyClass),
                    code(INTENT_OPERATIONS[operation].actionClassFloor),
                    code(INTENT_OPERATIONS[operation].permission),
                ]),
            ),
        },
        {
            name: "meanings",
            markdown: table(
                ["Meaning", "Flow", "Capability-writable"],
                MAPPABLE_MEANINGS.map((meaning) => [
                    code(meaning),
                    FLOW_NAMES[MEANING_FACTS[meaning].flow],
                    MEANING_WRITABLE[meaning],
                ]),
            ),
        },
    ];
}

// ─── The producer table ──────────────────────────────────────────────

/**
 * The producer table of `design/contracts/facts.md` §2, from `PRODUCERS`.
 *
 * One row per producer and per kind it makes a record of, because the registry
 * is keyed that way and a producer that reads differently on the two kinds —
 * the sweep, whose issues carry no `review` — cannot be told the truth about in
 * one row. `position` is a column of constants: every producer reads it, and a
 * table that omitted it would read as though some producer might not.
 *
 * A cell is what the row PROMISES. A read the endpoint-permission matrix has
 * not confirmed still leaves its group unread on the day, which is the prose
 * under the table's job to say, not a generator's.
 */
export function renderProducerTable(): readonly GeneratedBlock[] {
    const rows = PRODUCER_NAMES.flatMap((producer) =>
        FACT_KINDS.filter((kind) => producesKind(producer, kind)).map((kind) => [
            code(producer),
            code(kind),
            "read",
            ...FACT_GROUPS.map((group) =>
                !carriesFactGroup(kind, group)
                    ? "—"
                    : producerReads(producer, kind, group)
                      ? "read"
                      : "unread",
            ),
        ]),
    );
    return [
        {
            name: "producers",
            markdown: table(["Producer", "Kind", "position", ...FACT_GROUPS], rows),
        },
    ];
}

// ─── The safety engine's code tables ─────────────────────────────────

/** What raises a code, and what it means. Both columns are prose (D76). */
interface CodeFacts {
    readonly raisedBy: string;
    readonly meaning: string;
}

/**
 * Key ORDER is the table's order, and the doc's order is deliberate:
 * `itemClosed` precedes `itemBlocked` because closure is terminal where a
 * pause is not, and the precedence section above the table says so.
 */
const REFUSAL_CODES: { readonly [C in SafetyRefusalCode]: CodeFacts } = {
    killSwitch: {
        raisedBy: "intent preflight",
        meaning:
            "An operator pulled the brake; every returned intent is refused, including observation-class intents. Capability and resolver evaluation has already occurred (D117).",
    },
    wrongEntryPoint: {
        raisedBy: "`write.ts`",
        meaning: "A clock-triggered destructive request arrived at the general door.",
    },
    preventiveGateUnavailable: {
        raisedBy: "`write.ts`",
        meaning: "The immediate-preventive class has no gate yet.",
    },
    capabilityDisabled: {
        raisedBy: "general rules",
        meaning: "The repository did not enable this capability.",
    },
    permissionMissing: {
        raisedBy: "general rules",
        meaning: "The installation lacks a grant the request requires.",
    },
    itemClosed: {
        raisedBy: "general rules",
        meaning:
            "The observed item is closed; a closed item accepts no capability write. Reported ahead of `itemBlocked`, because closure is terminal where a pause is not.",
    },
    itemBlocked: {
        raisedBy: "general rules",
        meaning: "A mapped `blocked` meaning pauses capability writes for this item.",
    },
    preconditionStale: {
        raisedBy: "preflight",
        meaning: "The authoritative precondition is unavailable, conflicted, or no longer holds.",
    },
    newerHumanChange: {
        raisedBy: "general rules",
        meaning: "A human changed the item at or after the cause; ties go to the human.",
    },
    humanOrderingUnknown: {
        raisedBy: "general rules",
        meaning:
            "Ordering evidence could not be established, which is a conflict and never an absence.",
    },
    invalidTimestamp: {
        raisedBy: "general rules",
        meaning: "The observation or human-change timestamp is not a finite time.",
    },
    modeDisabled: {
        raisedBy: "general rules",
        meaning: "The repository mode is `disabled`.",
    },
    wrongActionClass: {
        raisedBy: "`destructive.ts`",
        meaning: "A non-destructive request arrived at the destructive door.",
    },
    noWarning: {
        raisedBy: "`destructive.ts`",
        meaning: "No recorded warning; a destructive action never occurs on first observation.",
    },
    warningRequestMismatch: {
        raisedBy: "`destructive.ts`",
        meaning:
            "The warning authorizes a different capability, target, change, or causal observation.",
    },
    invalidDestructivePlan: {
        raisedBy: "`destructive.ts`",
        meaning:
            "The plan carries a non-finite value, or a warning predating its observation or shorter than the full grace period.",
    },
    graceBelowFloor: {
        raisedBy: "`destructive.ts`",
        meaning: "The grace period is below `MIN_GRACE_DAYS`.",
    },
    graceRunning: {
        raisedBy: "`destructive.ts`",
        meaning: "The grace period has not fully elapsed.",
    },
    activityCancelled: {
        raisedBy: "`destructive.ts`",
        meaning: "The affected person provided qualifying activity during the grace period.",
    },
};

/** Not refusals: the decision was reached and written down instead (D57). */
const RECORD_ONLY_CODES: { readonly [C in RecordOnlyCode]: string } = {
    observation: "The request's class is `observation`.",
    modeRecordsOnly: "The repository mode is `observe` or `dry-run`.",
};

/** The two verdict-code tables of `design/contracts/safety.md`. */
export function renderSafetyCodeTables(): readonly GeneratedBlock[] {
    return [
        {
            name: "refusal-codes",
            markdown: table(
                ["Code", "Raised by", "Meaning"],
                keysOf(REFUSAL_CODES).map((name) => [
                    code(name),
                    REFUSAL_CODES[name].raisedBy,
                    REFUSAL_CODES[name].meaning,
                ]),
            ),
        },
        {
            name: "record-only-codes",
            markdown: table(
                ["Code", "Raised when"],
                keysOf(RECORD_ONLY_CODES).map((name) => [code(name), RECORD_ONLY_CODES[name]]),
            ),
        },
    ];
}

// ─── The shipped capabilities, for a maintainer ──────────────────────

/**
 * What each operation is, said to the person whose repository it writes to.
 * A capability's declaration names operations; a maintainer reads what they
 * will see happen. The mapped type is what makes a new operation fail to
 * compile here until it has a sentence.
 */
const WRITES: { readonly [K in IntentOperation]: string } = {
    postManagedComment: "a comment it keeps up to date",
    applyMappedLabel: "your mapped labels",
    assign: "an assignment",
    unassign: "an unassignment",
    releaseAssignment: "an assignment's release, after a warning",
    closePullRequest: "a pull request's closure, after a warning",
    lockIssue: "a lock on an issue",
    unlockIssue: "an unlock",
};

/**
 * The families a declaration may require, as a record so `keysOf` keeps them
 * typed — a family added to `RequiredMappings` fails to compile here until
 * the table can show it.
 */
const REQUIRABLE_FAMILIES: { readonly [F in keyof RequiredMappings]-?: true } = {
    labels: true,
    commands: true,
    skills: true,
};

function isOperation(name: string): name is IntentOperation {
    return Object.hasOwn(INTENT_OPERATIONS, name);
}

/**
 * The capability table of `docs/capabilities.md`, from the shipped folders.
 *
 * Every cell is derived: the purpose is the design page's own title, the
 * trigger and the lists are the declaration's, and the design link is the
 * folder. The one sentence a maintainer needs that no declaration carries —
 * what an operation is — is `WRITES`, kept here where review owns it.
 */
export function renderCapabilityTable(): readonly GeneratedBlock[] {
    const wakes = (trigger: DeclaredTrigger): string =>
        trigger.kind === "event"
            ? `the ${code(trigger.event)} webhook`
            : `a schedule (${trigger.description})`;
    const mapped = (required: RequiredMappings): string => {
        const names = keysOf(REQUIRABLE_FAMILIES).flatMap((family) =>
            (required[family] ?? []).map((meaning) => code(`${family}.${meaning}`)),
        );
        return names.length === 0 ? "nothing required" : names.join(", ");
    };
    const writes = (intents: readonly string[]): string =>
        intents
            .map((intent) => {
                if (!isOperation(intent)) throw new Error(`${intent} is not an operation`);
                return WRITES[intent];
            })
            .join("; ");
    return [
        {
            name: "capabilities",
            markdown: table(
                [
                    "Capability",
                    "What it does",
                    "Wakes on",
                    "Needs mapped",
                    "Settings keys",
                    "May write",
                    "Design",
                ],
                shippedCapabilities().map((capability) => [
                    code(capability.name),
                    capability.purpose,
                    capability.triggers.map(wakes).join(", "),
                    mapped(capability.requiredMappings),
                    capability.configKeys.length === 0 ? "none" : codeList(capability.configKeys),
                    writes(capability.intents),
                    `[design page](../${capability.folder}/design.md)`,
                ]),
            ),
        },
    ];
}

/** Every document with generated blocks — the runner's whole worklist. */
export function generatedDocuments(): readonly GeneratedDocument[] {
    return [
        { path: "design/contracts/catalogue.md", blocks: renderCatalogueTables() },
        { path: "design/contracts/facts.md", blocks: renderProducerTable() },
        { path: "design/contracts/safety.md", blocks: renderSafetyCodeTables() },
        { path: "docs/capabilities.md", blocks: renderCapabilityTable() },
    ];
}
