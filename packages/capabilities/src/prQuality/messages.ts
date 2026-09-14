/** Everything prQuality says to a contributor, and the words it says it in. */

/** The linked-issue check's row of the dashboard, when the check fails. */
const NO_LINKED_ISSUE =
    "This pull request does not reference an issue. Adding a closing reference keeps the issue and the pull request in step.";

/** The row, ending in the maintainer's guide sentence when one is set; their own text, so not `inert`. */
export function noLinkedIssue(guide: string | null): string {
    return guide === null ? NO_LINKED_ISSUE : `${NO_LINKED_ISSUE} See the guide: ${guide}`;
}
