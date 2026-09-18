/**
 * The label each meaning has unless a repository maps its own: a spelling, a
 * colour and a description (D203). A label the repository already holds under
 * that spelling is used as it is, colour included.
 */

import type { MappableMeaning } from "./schema.js";

export interface LabelDefault {
    /** The spelling a repository gets without a mapping; `mappings.labels` overrides it. */
    readonly name: string;
    /** Six hex digits, no `#` — GitHub's spelling. */
    readonly color: string;
    readonly description: string;
}

export const LABEL_DEFAULTS: { readonly [M in MappableMeaning]: LabelDefault } = {
    awaitingTriage: {
        name: "status: triage",
        color: "fbca04",
        description: "New; waiting for a maintainer to triage",
    },
    ready: {
        name: "status: ready",
        color: "0e8a16",
        description: "Triaged and ready to be picked up",
    },
    inProgress: {
        name: "status: in progress",
        color: "1d76db",
        description: "Someone is working on it",
    },
    needsReview: {
        name: "status: needs review",
        color: "5319e7",
        description: "Waiting for a maintainer's review",
    },
    needsRevision: {
        name: "status: needs revision",
        color: "d93f0b",
        description: "Changes are needed before review",
    },
    readyToMerge: {
        name: "status: ready to merge",
        color: "006b75",
        description: "Approved and waiting to merge",
    },
    blocked: {
        name: "status: blocked",
        color: "b60205",
        description: "Paused by a person; every clock waits",
    },
};

/** The label mapping a document gets before it maps anything: every meaning at its default spelling. */
export const DEFAULT_LABEL_MAPPINGS: { readonly [M in MappableMeaning]: string } =
    Object.fromEntries(
        Object.entries(LABEL_DEFAULTS).map(([meaning, label]) => [meaning, label.name]),
    ) as { readonly [M in MappableMeaning]: string };
