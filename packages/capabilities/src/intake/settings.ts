/**
 * The settings intake reads from its `settings:` block in `automations.yml`.
 *
 * The seed's key, not the design's. `design.md` describes two stations of
 * settings intake does not have yet; promoting them is the seed's own build,
 * and a spec that declared them here would claim a capability that is not
 * there.
 */

import { flag, spec } from "@hiero-hackers/automation-core";

/** The one key the seed reads: announce the triage placement, or stay quiet. */
export const INTAKE_SETTINGS = spec({
    announce: flag({ default: false }),
});
