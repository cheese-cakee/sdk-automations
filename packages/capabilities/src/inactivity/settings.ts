/**
 * The settings inactivity reads from its `settings:` block in `automations.yml`
 * — `design.md`'s config section as a spec.
 *
 * Two ladders over one pair of clocks. `issues` and `pullRequests` are blocks
 * because each is opt-in; `reapWhen` is a section of three named reasons rather
 * than an open mapping, because the reasons are the platform's vocabulary and a
 * repository cannot invent a fourth.
 *
 * Every `days` inside a ladder inherits by NAME, so the spec states the chain by
 * naming the field and the reader walks it: reason → ladder → capability
 * default (`design/guides/capability-kits.md` §3.1). `above` rides on every
 * `reapAfterDays` so the design's "at every level" sentence is checked at every
 * level, and `MIN_GRACE_DAYS` is imported rather than restated.
 */

import { block, days, flag, MIN_GRACE_DAYS, section, spec } from "@hiero-hackers/automation-core";

/** One ladder's two clocks, spelled once and used at both levels that have them. */
const ladder = {
    remindAfterDays: days({ inherits: "remindAfterDays" }),
    reapAfterDays: days({
        inherits: "reapAfterDays",
        above: ["remindAfterDays", MIN_GRACE_DAYS],
    }),
};

/** The five keys a repository may state, and what each is worth unstated. */
export const INACTIVITY_SETTINGS = spec({
    exemptBlocked: flag({ default: true }),
    remindAfterDays: days({ default: 14 }),
    reapAfterDays: days({ default: 21, above: ["remindAfterDays", MIN_GRACE_DAYS] }),
    issues: block({ ...ladder }),
    pullRequests: block({
        ...ladder,
        reapWhen: section({
            draft: block({ ...ladder }),
            changesRequested: block({ ...ladder }),
            needsRevision: block({ ...ladder }),
        }),
    }),
});
