/**
 * What a delivery is, and what comes back from operating on one: one input and one
 * closed result type per durable-intake operation. Vocabulary only.
 */

import type { DeliveryGuid } from "@hiero-hackers/automation-core";

/**
 * One delivery's durable queue state.
 * `failed` is the dead letter: nothing claims it again, and it keeps its payload.
 */
export type DeliveryState = "pending" | "processing" | "done" | "failed";

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

/**
 * A delivery plus the token that currently owns its processing claim.
 * `attempts` counts the failures preceding this claim, so a first claim reads zero.
 */
export interface ClaimedDelivery {
    readonly deliveryId: DeliveryGuid;
    readonly eventName: string;
    readonly payload: Uint8Array;
    readonly payloadDigest: string;
    readonly receivedAt: string;
    readonly worker: string;
    readonly claimedAt: string;
    readonly claimToken: string;
    readonly attempts: number;
}

/** Everything the store must bind to one completion commit (D173). */
export interface CompleteDeliveryInput {
    readonly deliveryId: DeliveryGuid;
    readonly eventName: string;
    readonly payloadDigest: string;
    readonly claimToken: string;
    readonly completedAt: string;
}

/** The closed result of attempting the completion commit. */
export type CompleteDeliveryResult =
    | { readonly outcome: "completed" }
    | { readonly outcome: "alreadyCompleted" }
    | { readonly outcome: "notOwned" }
    | { readonly outcome: "identityMismatch" };

/** Whether the supplied token released its delivery claim. */
export type ReleaseDeliveryResult =
    { readonly outcome: "released" } | { readonly outcome: "notOwned" };

/**
 * One failed processing attempt, and the two instants that decide what happens next.
 * Both are caller-supplied: the store counts attempts, the caller owns the policy.
 */
export interface ReleaseDeliveryAfterFailureInput {
    readonly deliveryId: DeliveryGuid;
    readonly claimToken: string;
    readonly failedAt: string;
    readonly retryNotBefore: string;
    readonly maxAttempts: number;
}

/** What the counted failure did to the delivery, `attempts` now included. */
export type ReleaseDeliveryAfterFailureResult =
    | {
          readonly outcome: "retryScheduled";
          readonly attempts: number;
          readonly retryNotBefore: string;
      }
    | { readonly outcome: "deadLettered"; readonly attempts: number }
    | { readonly outcome: "notOwned" };

/** One dead-lettered delivery's identity, without its retained bytes. */
export interface DeadLetteredDelivery {
    readonly deliveryId: DeliveryGuid;
    readonly eventName: string;
    readonly payloadDigest: string;
    readonly receivedAt: string;
    readonly attempts: number;
    readonly failedAt: string;
}

/** How many deliveries sit in each state, and the oldest completion still kept (D168). */
export interface DeliveryCounts {
    readonly pending: number;
    readonly processing: number;
    readonly done: number;
    readonly failed: number;
    readonly oldestDone: string | null;
}

/** The newest delivery by receipt, with the instant it finished (D168). */
export interface NewestDelivery {
    readonly receivedAt: string;
    readonly completedAt: string | null;
}
