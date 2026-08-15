import {
    admitPullRequest,
    decideLinkedIssue,
    parseConfigDocument,
    type ConfigError,
    type LinkedIssueReader,
    type LinkedIssueReport,
    type RepositoryRef,
} from "@hiero-hackers/automation-core";
import type { ClaimedDelivery, Store } from "@hiero-hackers/automation-store";
import type { ConfigSource } from "./config.js";

const STALE_CLAIM_MINUTES = 15;
interface RecordIdentity {
    readonly deliveryId: string;
    readonly event: string;
    readonly receivedAt: string;
    readonly decidedAt: string;
    readonly configRevision: string;
}
export type ShellRecord = RecordIdentity &
    (
        | { readonly kind: "linkedIssue"; readonly report: LinkedIssueReport }
        | { readonly kind: "configRejected"; readonly errors: readonly ConfigError[] }
        | { readonly kind: "modeUnsupported"; readonly reason: string }
    );
export interface ProcessorOptions {
    readonly store: Store;
    readonly configSource: ConfigSource;
    readonly linkedIssueReader: LinkedIssueReader;
    readonly repository: RepositoryRef;
    readonly worker: string;
    readonly clock: () => Date;
}

export class Processor {
    private draining: Promise<void> | null = null;
    constructor(private readonly options: ProcessorOptions) {}
    async processOnce(): Promise<boolean> {
        const claimed = this.claimNext();
        if (claimed === undefined) return false;
        try {
            const record = await this.process(claimed);
            const completion = this.options.store.completeDeliveryWithReport({
                deliveryId: claimed.deliveryId,
                eventName: claimed.eventName,
                payloadDigest: claimed.payloadDigest,
                claimToken: claimed.claimToken,
                reportJson: JSON.stringify(record),
                completedAt: this.options.clock().toISOString(),
            });
            if (completion.outcome !== "completed")
                throw new Error(`delivery report was not committed: ${completion.outcome}`);
            return true;
        } catch (error) {
            this.options.store.releaseDelivery(claimed.deliveryId, claimed.claimToken);
            throw error;
        }
    }
    drain(): Promise<void> {
        this.draining ??= (async () => {
            try {
                while (await this.processOnce());
            } finally {
                this.draining = null;
            }
        })();
        return this.draining;
    }
    private claimNext(): ClaimedDelivery | undefined {
        const now = this.options.clock();
        return this.options.store.claimNextDelivery(
            this.options.worker,
            now.toISOString(),
            new Date(now.getTime() - STALE_CLAIM_MINUTES * 60_000).toISOString(),
        );
    }
    private async process(claimed: ClaimedDelivery): Promise<ShellRecord> {
        const document = await this.options.configSource.load();
        const config = parseConfigDocument(document.text);
        const identity: RecordIdentity = {
            deliveryId: claimed.deliveryId as string,
            event: claimed.eventName,
            receivedAt: claimed.receivedAt,
            decidedAt: this.options.clock().toISOString(),
            configRevision: document.revision,
        };
        if (!config.ok) return { kind: "configRejected", ...identity, errors: config.errors };
        if (config.config.mode === "active")
            return {
                kind: "modeUnsupported",
                ...identity,
                reason: "active mode is unsupported because GitHub effects are not implemented",
            };
        const admission = admitPullRequest(
            claimed.eventName,
            parsePayload(claimed.payload),
            this.options.repository,
        );
        if (admission.kind !== "accepted")
            return {
                kind: "linkedIssue",
                ...identity,
                report: {
                    capability: "linkedIssue",
                    mode: config.config.mode,
                    repository: this.options.repository,
                    pullRequest: null,
                    outcome: admission.kind,
                    observation: null,
                    desiredAdvisories: [],
                    reason: admission.reason,
                },
            };
        if (config.config.mode === "disabled" || !config.config.enabled)
            return {
                kind: "linkedIssue",
                ...identity,
                report: decideLinkedIssue(config.config, admission.input, {
                    outcome: "unknown",
                    reason: "not read because the capability is disabled",
                }),
            };
        const observation = await this.options.linkedIssueReader.read(admission.input);
        return {
            kind: "linkedIssue",
            ...identity,
            report: decideLinkedIssue(config.config, admission.input, observation),
        };
    }
}
function parsePayload(bytes: Uint8Array): unknown {
    try {
        return JSON.parse(Buffer.from(bytes).toString("utf8"));
    } catch {
        return undefined;
    }
}
