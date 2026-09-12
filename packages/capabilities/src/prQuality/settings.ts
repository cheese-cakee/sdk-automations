/**
 * The settings prQuality reads from its `settings:` block in `automations.yml`.
 *
 * The empty spec is the written answer, not a forgotten file: prQuality
 * declares no config keys at all (D125), so a repository has nothing to supply
 * and `evaluate` has nothing to read. `design.md`'s `checks` block belongs to
 * the seed's own build.
 */

import { spec } from "@hiero-hackers/automation-core";

/** No keys. An empty spec cannot be unusable, so nothing reads it. */
export const PR_QUALITY_SETTINGS = spec({});
