/**
 * An issue's open pull requests, from the driver's inverse; a pull request's linked
 * issues, its closing references joined to the listed issues with their clocks.
 */

import type { LinkedIssue } from "@hiero-hackers/automation-core";
import { unreadable } from "../items.js";
import type { SweepGroup } from "./module.js";

export const links = {
    reads: ["linkedIssuesBatch", "linkedIssues", "assignedAt", "lastWorkingAt"],
    read: {
        issue: ({ openPullRequests }) =>
            Promise.resolve(
                openPullRequests === "unread"
                    ? unreadable("the linked-issue read answered nothing")
                    : { ok: true, value: { openPullRequests } },
            ),
        pullRequest: async ({ closes, openIssues, clocksFor }) => {
            if (closes === "unread") return unreadable("the linked-issue read answered nothing");
            const issues: LinkedIssue[] = [];
            for (const reference of closes) {
                const listed = openIssues.find((open) => open.item.number === reference.number);
                // A link outside this sweep's open set is not read separately.
                if (listed === undefined) continue;
                const read = await clocksFor(listed.item, listed.assignees);
                if (!read.ok) return read;
                issues.push({ item: listed.item, assignees: read.value });
            }
            return { ok: true, value: { issues } };
        },
    },
} satisfies SweepGroup<"links">;
