/**
 * The settings prQuality reads beside its `enabled`: `design.md`'s `checks`
 * block, at the size the shipped code can honestly read.
 */

import { block, section, spec, text } from "@hiero-hackers/automation-core";

/** The checks a repository may switch on, and where each failure sends a reader. */
export const PR_QUALITY_SETTINGS = spec({
    checks: section(
        {
            linkedIssues: block(
                {
                    guide: text({
                        optional: true,
                        doc: "A page explaining how to link an issue, shown to the contributor when this check fails",
                    }),
                },
                { doc: "Say so when a pull request references no issue" },
            ),
        },
        { doc: "The quality checks this repository runs — each one off until it is enabled" },
    ),
});
