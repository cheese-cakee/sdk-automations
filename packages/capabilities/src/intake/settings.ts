/** The settings intake reads beside its `enabled`. */

import { flag, spec } from "@hiero-hackers/automation-core/author";

/** The one key the seed reads: announce the triage placement, or stay quiet. */
export const INTAKE_SETTINGS = spec({
    announce: flag({
        default: false,
        doc: "Comment on a new issue to say it is waiting for triage, rather than only labelling it",
    }),
});
