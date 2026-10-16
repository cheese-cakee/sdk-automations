/**
 * What the triage rehearsal asks of the running shell: each scenario's human actions, and the
 * state GitHub must read back after every one. The run is in `run.ts`; this file is data.
 */

/** The labels the rehearsal's config maps: two positions, the pause flag and one skill tier. */
export const LABELS = {
    triage: "status: triage",
    ready: "status: ready for dev",
    blocked: "status: blocked",
    skill: "skill: beginner",
} as const;

export type Meaning = keyof typeof LABELS;

/** One thing the person does to the scenario's issue. */
export type Action =
    | { readonly kind: "open"; readonly labels: readonly Meaning[] }
    | { readonly kind: "openFromTemplate" }
    | { readonly kind: "add"; readonly meaning: Meaning }
    | { readonly kind: "remove"; readonly meaning: Meaning }
    | { readonly kind: "redeliverOpened" }
    | { readonly kind: "releaseAtOnce" };

/**
 * The issue after a step settles. Counts are cumulative over the issue's life.
 * `refusals` are decision codes this step's deliveries must record.
 */
export interface Expected {
    readonly labels: readonly Meaning[];
    readonly locked: boolean;
    readonly appComments: number;
    readonly appLabelWrites: number;
    /** Ticked rows in the welcome's checklist; judged only where a step names it. */
    readonly ticked?: number;
    readonly refusals?: readonly string[];
}

export interface Step {
    readonly action: Action;
    readonly expected: Expected;
}

export interface Scenario {
    readonly name: string;
    readonly question: string;
    readonly steps: readonly Step[];
}

const queued: Expected = { labels: ["triage"], locked: true, appComments: 1, appLabelWrites: 1 };

export const SCENARIOS: readonly Scenario[] = [
    {
        name: "plain-open",
        question:
            "A plain issue is labelled, welcomed and locked; a redelivery changes nothing; " +
            "ready beside the triage label holds; removing the triage label releases it.",
        steps: [
            { action: { kind: "open", labels: [] }, expected: queued },
            { action: { kind: "redeliverOpened" }, expected: queued },
            {
                action: { kind: "add", meaning: "ready" },
                expected: {
                    ...queued,
                    labels: ["triage", "ready"],
                    refusals: ["preconditionStale"],
                },
            },
            {
                action: { kind: "remove", meaning: "triage" },
                expected: { labels: ["ready"], locked: false, appComments: 2, appLabelWrites: 1 },
            },
        ],
    },
    {
        name: "clean-ready",
        question: "Ready added to a locked issue that carries no other position releases it.",
        steps: [
            { action: { kind: "open", labels: [] }, expected: queued },
            { action: { kind: "remove", meaning: "triage" }, expected: { ...queued, labels: [] } },
            {
                action: { kind: "add", meaning: "ready" },
                expected: { labels: ["ready"], locked: false, appComments: 2, appLabelWrites: 1 },
            },
        ],
    },
    {
        name: "prelabelled-api",
        question: "An issue created already carrying the triage label is welcomed and locked.",
        steps: [
            {
                action: { kind: "open", labels: ["triage"] },
                expected: { ...queued, appLabelWrites: 0 },
            },
        ],
    },
    {
        name: "prelabelled-template",
        question:
            "An issue opened from a template that applies the triage label is welcomed and locked.",
        steps: [
            { action: { kind: "openFromTemplate" }, expected: { ...queued, appLabelWrites: 0 } },
        ],
    },
    {
        name: "blocked-ready",
        question:
            "Ready on a blocked issue is refused, and removing blocked does not release it either: " +
            "a person unlocks it.",
        steps: [
            { action: { kind: "open", labels: [] }, expected: queued },
            { action: { kind: "remove", meaning: "triage" }, expected: { ...queued, labels: [] } },
            {
                action: { kind: "add", meaning: "blocked" },
                expected: { ...queued, labels: ["blocked"] },
            },
            {
                action: { kind: "add", meaning: "ready" },
                expected: { ...queued, labels: ["blocked", "ready"], refusals: ["itemBlocked"] },
            },
            {
                action: { kind: "remove", meaning: "blocked" },
                expected: { ...queued, labels: ["ready"] },
            },
        ],
    },
    {
        name: "skill-relabel",
        question:
            "A skill label added, then removed, while the issue waits ticks and clears the " +
            "welcome's checklist row in place.",
        steps: [
            { action: { kind: "open", labels: [] }, expected: { ...queued, ticked: 0 } },
            {
                action: { kind: "add", meaning: "skill" },
                expected: { ...queued, labels: ["triage", "skill"], ticked: 1 },
            },
            { action: { kind: "remove", meaning: "skill" }, expected: { ...queued, ticked: 0 } },
        ],
    },
    {
        name: "simultaneous-release",
        question:
            "Ready added and the triage label removed in the same moment release the issue once.",
        steps: [
            { action: { kind: "open", labels: [] }, expected: queued },
            {
                action: { kind: "releaseAtOnce" },
                expected: { labels: ["ready"], locked: false, appComments: 2, appLabelWrites: 1 },
            },
        ],
    },
];
