/** The settings intake reads beside its `enabled`. */

import { flag, spec } from "@hiero-hackers/automation-core/author";

/** Three flags: announce the placement, hold the lock until triage completes, confirm the release. */
export const INTAKE_SETTINGS = spec({
    announce: flag({
        default: false,
        doc: "Comment on a new issue to say it is waiting for triage, rather than only labelling it",
    }),
    lockUntilTriaged: flag({
        default: false,
        doc: "Lock a new issue's conversation until a person adds the ready label; the welcome is posted either way",
    }),
    confirmUnlock: flag({
        default: false,
        doc: "Comment when the ready label unlocks an issue; inert unless lockUntilTriaged is on",
    }),
});
