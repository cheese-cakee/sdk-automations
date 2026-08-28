/**
 * What a delivery is, and what comes back from operating on one: one
 * input and one closed result type per durable-intake operation.
 *
 * Vocabulary only. `store.ts` owns the transitions and the SQLite rows
 * behind them, `schema.ts` the table definitions. `effects.ts` and
 * `schedules.ts` are the sibling vocabularies.
 */

import type { DeliveryGuid } from "@hiero-hackers/automation-core";

/** One delivery's durable queue state. */
export type DeliveryState = "pending" | "processing" | "done";

/** Verified bytes and identity offered at the durable intake boundary. */
export interface AcceptDeliveryInput {
    readonly deliveryId: DeliveryGuid;
    readonly eventName: string;
    readonly payload: Uint8Array;
    readonly receivedAt: string;
}

/** The accepted, duplicate, or conflicting intake classification. */
export type AcceptDeliveryResult =
    | {
          readonly outcome: "accepted";
          readonly state: "pending";
          readonly payloadDigest: string;
      }
    | {
          readonly outcome: "duplicate";
          readonly state: DeliveryState;
          readonly payloadDigest: string;
      }
    | {
          readonly outcome: "conflict";
          readonly state: DeliveryState;
          readonly eventNameMismatch: boolean;
          readonly payloadMismatch: boolean;
      };

/** A delivery plus the token that currently owns its processing claim. */
export interface ClaimedDelivery {
    readonly deliveryId: DeliveryGuid;
    readonly eventName: string;
    readonly payload: Uint8Array;
    readonly payloadDigest: string;
    readonly receivedAt: string;
    readonly worker: string;
    readonly claimedAt: string;
    readonly claimToken: string;
}

/** Everything the store must bind to one report-and-completion commit. */
export interface CompleteDeliveryWithReportInput {
    readonly deliveryId: DeliveryGuid;
    readonly eventName: string;
    readonly payloadDigest: string;
    readonly claimToken: string;
    readonly reportJson: string;
    readonly completedAt: string;
}

/** The closed result of attempting the report-and-completion commit. */
export type CompleteDeliveryWithReportResult =
    | { readonly outcome: "completed" }
    | { readonly outcome: "alreadyCompleted" }
    | { readonly outcome: "notOwned" }
    | { readonly outcome: "identityMismatch" }
    | { readonly outcome: "reportConflict" };

/** Whether the supplied token released its delivery claim. */
export type ReleaseDeliveryResult =
    { readonly outcome: "released" } | { readonly outcome: "notOwned" };

/** One canonical report in deterministic projection-replay order. */
export interface CanonicalDeliveryReport {
    readonly deliveryId: DeliveryGuid;
    readonly reportJson: string;
    readonly completedAt: string;
}
