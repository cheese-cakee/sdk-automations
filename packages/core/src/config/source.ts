/**
 * Repository configuration identity and the seam it arrives through,
 * shared by the local and GitHub sources.
 */

import { createHash } from "node:crypto";

/** The path inside the configured repository, relative to its root (D93). */
export const CONFIG_PATH = "automations.yml";
/** The revision every source stamps on a confidently absent config. */
export const ABSENT_CONFIG_REVISION = "sha256:absent";
/** Stamped on records when a defective file's own revision is unknowable. */
export const UNREADABLE_CONFIG_REVISION = "sha256:unreadable";

/**
 * Content-addressed, so a changed file is always a changed revision — and
 * the SAME text is the SAME revision whichever source loaded it (D122's
 * follow-on): the local copy and the live default-branch read agree.
 */
export function revisionOf(text: string): string {
    return `sha256:${createHash("sha256").update(text).digest("hex").slice(0, 12)}`;
}

export interface ConfigDocument {
    /** Names WHICH text was decided on; lands in every persisted record. */
    readonly revision: string;
    readonly text: string;
}

/**
 * What one load attempt produced — a typed value, never a throw (D122).
 *
 * The failure branches carry the one fact the processor branches on:
 * whether a retry can ever help. `permanent` means the COMMITTED FILE is
 * defective, so the delivery completes as `configRejected`; anything else
 * releases the claim and retries.
 */
export type ConfigLoadOutcome =
    | { readonly ok: true; readonly document: ConfigDocument }
    | {
          readonly ok: false;
          readonly permanent: true;
          readonly detail: string;
          /** The defective file's own revision, when the source saw one. */
          readonly revision?: string;
      }
    | { readonly ok: false; readonly permanent: false; readonly detail: string };

/** Where a repository's configuration text comes from; one per composition. */
export interface ConfigSource {
    load(): Promise<ConfigLoadOutcome>;
}
