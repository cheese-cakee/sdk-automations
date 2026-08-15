import type { LinkedIssueConfig, RepositoryMode } from "./config.js";
export const LINKED_ISSUE_ADVISORY =
    "This pull request is not linked to an issue. Add a closing reference such as `Closes #123`.";
export interface RepositoryRef {
    readonly owner: string;
    readonly repo: string;
}
export interface PullRequestInput {
    readonly repository: RepositoryRef;
    readonly number: number;
    readonly state: "open";
}
export type LinkedIssueObservation =
    | { readonly outcome: "present" }
    | { readonly outcome: "absent" }
    | { readonly outcome: "unknown"; readonly reason: string };
export interface LinkedIssueReader {
    read(input: PullRequestInput): Promise<LinkedIssueObservation>;
}
export interface LinkedIssueReport {
    readonly capability: "linkedIssue";
    readonly mode: Exclude<RepositoryMode, "active">;
    readonly repository: RepositoryRef;
    readonly pullRequest: number | null;
    readonly outcome:
        | "satisfied"
        | "observedAbsent"
        | "advisoryDesired"
        | "unknown"
        | "disabled"
        | "ignored"
        | "refused";
    readonly observation: LinkedIssueObservation | null;
    readonly desiredAdvisories: readonly string[];
    readonly reason?: string;
}
type LinkedIssueDecisionConfig = Omit<LinkedIssueConfig, "mode"> & {
    readonly mode: Exclude<RepositoryMode, "active">;
};
export function decideLinkedIssue(
    config: LinkedIssueDecisionConfig,
    input: PullRequestInput,
    observation: LinkedIssueObservation,
): LinkedIssueReport {
    const base = {
        capability: "linkedIssue" as const,
        mode: config.mode,
        repository: input.repository,
        pullRequest: input.number,
    };
    if (config.mode === "disabled" || !config.enabled)
        return { ...base, outcome: "disabled", observation: null, desiredAdvisories: [] };
    if (observation.outcome === "unknown")
        return {
            ...base,
            outcome: "unknown",
            observation,
            desiredAdvisories: [],
            reason: observation.reason,
        };
    if (observation.outcome === "present")
        return { ...base, outcome: "satisfied", observation, desiredAdvisories: [] };
    return {
        ...base,
        outcome: config.mode === "dry-run" ? "advisoryDesired" : "observedAbsent",
        observation,
        desiredAdvisories: config.mode === "dry-run" ? [LINKED_ISSUE_ADVISORY] : [],
    };
}
export type PullRequestAdmission =
    | { readonly kind: "accepted"; readonly input: PullRequestInput }
    | { readonly kind: "ignored" | "refused"; readonly reason: string };
export function admitPullRequest(
    event: string,
    payload: unknown,
    configured: RepositoryRef,
): PullRequestAdmission {
    if (event !== "pull_request")
        return { kind: "ignored", reason: `unsupported event "${event}"` };
    if (typeof payload !== "object" || payload === null || Array.isArray(payload))
        return { kind: "refused", reason: "payload is not an object" };
    const body = payload as Record<string, unknown>;
    if (!["opened", "edited", "reopened"].includes(String(body.action)))
        return {
            kind: "ignored",
            reason: `unsupported pull_request action "${String(body.action)}"`,
        };
    const repository = body.repository as Record<string, unknown> | undefined;
    const owner = repository?.owner as Record<string, unknown> | undefined;
    const pullRequest = body.pull_request as Record<string, unknown> | undefined;
    if (typeof repository?.name !== "string" || typeof owner?.login !== "string")
        return { kind: "refused", reason: "payload repository identity is malformed" };
    if (
        owner.login.toLowerCase() !== configured.owner.toLowerCase() ||
        repository.name.toLowerCase() !== configured.repo.toLowerCase()
    )
        return {
            kind: "refused",
            reason: "payload repository does not match the configured repository",
        };
    if (
        typeof body.number !== "number" ||
        !Number.isSafeInteger(body.number) ||
        body.number <= 0 ||
        pullRequest?.number !== body.number
    )
        return { kind: "refused", reason: "pull request number is malformed or inconsistent" };
    if (pullRequest.state !== "open" || pullRequest.closed_at !== null)
        return { kind: "refused", reason: "only open pull requests may request an advisory" };
    return {
        kind: "accepted",
        input: { repository: configured, number: body.number, state: "open" },
    };
}
