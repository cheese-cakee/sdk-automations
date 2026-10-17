/**
 * The run's job summary: what one Action run decided, item by item, as markdown, with the
 * workflow commands that surface a failure or a lowered mode on the run page.
 */

import { appendFileSync } from "node:fs";
import type { ItemRef, RepositoryRef } from "@hiero-hackers/automation-core";
import type { RunOutcome } from "../compose/action.js";
import type { ShellEvent } from "../log.js";
import { standing } from "./explain.js";
import type { Store } from "../../store/index.js";

/** What names the run in its heading. */
export interface SummaryRun {
    readonly repository: RepositoryRef;
    readonly eventName: string;
    readonly runUrl: string | null;
}

const LOWERED =
    "The configuration asked for `active`; it was decided as `dry-run` because the workflow did not arm writes.";

/** One table cell: backslashes first, then the pipe, so no input can close the cell. */
export const cell = (value: string | number | null): string =>
    value === null || value === ""
        ? "-"
        : String(value).replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\s+/g, " ");

const row = (cells: readonly (string | number | null)[]): string =>
    `| ${cells.map(cell).join(" | ")} |`;

const table = (head: readonly string[], rows: readonly string[]): string[] => [
    row(head),
    row(head.map(() => "---")),
    ...rows,
    "",
];

const spelled = (item: ItemRef): string => `${item.kind}#${String(item.number)}`;

/** The items once each, in the order they were decided. */
function distinct(items: readonly ItemRef[]): ItemRef[] {
    const seen = new Set<string>();
    return items.filter((item) => !seen.has(spelled(item)) && seen.add(spelled(item)));
}

/** The events that made the run exit non-zero. */
function failures(events: readonly ShellEvent[]): ShellEvent[] {
    return events.filter(
        (event) =>
            event.event === "deliveryAttemptFailed" ||
            event.event === "deliveryDeadLettered" ||
            event.event === "sweepFailed" ||
            (event.event === "deliveryCompleted" && event.kind === "repositoryMismatch"),
    );
}

const detailOf = (event: ShellEvent): string =>
    "detail" in event && typeof event.detail === "string" ? event.detail : "";

const named = (event: ShellEvent): string =>
    event.event === "deliveryCompleted" ? `${event.event} (${event.kind})` : event.event;

function itemSection(store: Store, repository: RepositoryRef, item: ItemRef): string[] {
    const decisions = store.ledger.decisionsOn(repository, item);
    const effects = store.ledger.effectsOn(repository, item);
    return [
        `### ${spelled(item)}`,
        "",
        ...table(
            ["capability", "verdict", "code", "detail"],
            decisions.map(({ capability, verdict, code, detail }) =>
                row([capability, verdict, code, detail]),
            ),
        ),
        ...table(
            ["effect", "stands"],
            effects.map((effectId) => row([effectId, standing(store, effectId)])),
        ),
    ];
}

export function renderSummary(store: Store, run: SummaryRun, outcome: RunOutcome): string {
    const { owner, repo } = run.repository;
    const link = run.runUrl === null ? "" : ` ([run](${run.runUrl}))`;
    const lines = [`## ${owner}/${repo}: ${run.eventName} (${outcome.kind})${link}`, ""];
    if (outcome.modeLowered) lines.push(LOWERED, "");
    for (const item of distinct(outcome.items)) {
        lines.push(...itemSection(store, run.repository, item));
    }
    const [cause] = failures(outcome.events);
    if (outcome.exitCode !== 0 && cause !== undefined) {
        const detail = detailOf(cause);
        lines.push(
            `The run exited non-zero: \`${named(cause)}\`${detail === "" ? "" : `, ${detail}`}.`,
        );
    }
    return `${lines.join("\n")}\n`;
}

/** One workflow command per failure and one notice when the mode was lowered. */
export function annotations(outcome: RunOutcome): string[] {
    const detail = (event: ShellEvent): string =>
        detailOf(event) === "" ? "" : ` ${detailOf(event)}`;
    return [
        ...(outcome.modeLowered ? [`::notice::${LOWERED}`] : []),
        ...failures(outcome.events).map((event) => `::warning::${named(event)}${detail(event)}`),
    ];
}

/** Appends to the step summary file when the runner names one. */
export function appendSummary(path: string | undefined, text: string): void {
    if (path === undefined || path === "") return;
    appendFileSync(path, text);
}
