/** What one write operation's transport is: the verbs it contributes; its endpoints are the client's (D176). */

import type {
    Allowance,
    ItemRef,
    RepositoryRef,
    WriteResult,
    WriteVerbs,
} from "@hiero-hackers/automation-core";
import { repoPath, type GitHubWriteRequest } from "../../client/contract.js";

/** The one status the endpoints disagree about; the fallback is `invisible`, never `already` (D46). */
export type NotFoundMeaning = "invisible" | "labelMayBeAbsent";

/** Nothing a builder receives is validated; the admission gate refuses a bad URL structurally. */
export interface VerbContext {
    readonly repository: RepositoryRef;
    apply(
        request: GitHubWriteRequest,
        notFound: NotFoundMeaning,
        allowance?: Allowance,
    ): Promise<WriteResult>;
}

export function issuePath(repository: RepositoryRef, item: ItemRef): string {
    return `${repoPath(repository)}/issues/${String(item.number)}`;
}

/** The pull-request view of the same number — a different row, and a different grant. */
export function pullPath(repository: RepositoryRef, item: ItemRef): string {
    return `${repoPath(repository)}/pulls/${String(item.number)}`;
}

export interface OperationTransport {
    verbs(context: VerbContext): Partial<WriteVerbs>;
}
