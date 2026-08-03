/**
 * The seam: capability intents in, executable effect plans out.
 *
 * `design/modules/contract.md` §3 ends at "the policy layer rejects an
 * intent when…" and §5 says a plan "records the safe call order"; the
 * executor begins at an `EffectPlan` that already exists. Nothing owned
 * the step between them, so the architecture's two halves — a capability
 * that describes a desired OUTCOME, and a recovery loop that drives
 * CALLS — had never been connected. This module is that step, and it is
 * where the safety engine actually runs.
 *
 * It lives in the executor rather than in core because it produces
 * `EffectPlan`, which the executor owns; the dependency arrow
 * (core ← store ← executor) is unchanged. Still pure — no store, no port,
 * no clock beyond the one the caller supplies.
 */

import {
    createDestructiveWarning,
    evaluateDestructive,
    evaluateWrite,
    idempotencyOf,
    screenIntent,
    type AnyIntent,
    type RecordOnlyCode,
    type RepositoryMode,
    type TypedDeclaration,
    type WriteContext,
    type WriteRequest,
} from "@hiero-hackers/automation-core";
import type { EffectPlan, PlannedCall } from "./recovery.js";

export type Disposition =
    | { readonly kind: "plan"; readonly intent: AnyIntent; readonly plan: EffectPlan }
    | {
          readonly kind: "record";
          readonly intent: AnyIntent;
          readonly code: RecordOnlyCode;
          readonly reason: string;
      }
    | {
          readonly kind: "refuse";
          readonly intent: AnyIntent;
          readonly code: string;
          readonly reason: string;
      };

export interface PlanningResult {
    /** One entry per input intent, in order — nothing is dropped silently. */
    readonly dispositions: readonly Disposition[];
    /** The `plan` dispositions' plans, for handing to `RecoveryExecutor`. */
    readonly plans: readonly EffectPlan[];
}

export interface PlanningInputs {
    readonly declaration: TypedDeclaration;
    /** The default-branch configuration revision the intents were formed under. */
    readonly revision: string;
    /**
     * The mode from the REVIEWED configuration (`RepositoryConfig.mode`).
     *
     * FINDING(planner-mode-duplicated): the repository mode exists twice
     * — once in the parsed configuration and once in `WriteContext`, which
     * is what `evaluateWrite` actually reads — and nothing required them
     * to agree. A shell that assembled the context from anywhere but the
     * config would write in `active` on a repository whose reviewed file
     * said `dry-run`, and every test would pass, because each half is
     * self-consistent. This was not reasoned out: the first composition
     * test set the config to `dry-run`, got a plan, and exposed it.
     *
     * Goal 2 makes the configured value authoritative ("a repository
     * declares its choices in a reviewed file"), so a disagreement is a
     * shell defect and the planner refuses rather than picking a winner.
     * Overriding the context silently would have been the tempting fix
     * and the wrong one — it repairs the symptom and leaves the shell
     * bug in place, unobserved.
     */
    readonly mode: RepositoryMode;
    /**
     * Facts rechecked immediately before the write, for THIS intent
     * (safety.md rule 4). A function rather than a value because
     * `preconditionHolds`, `itemBlocked`, and `latestHumanChangeAt` are
     * per-item: one observation can yield intents on several items, and a
     * single shared context would let one item's freshness vouch for
     * another's.
     */
    readonly contextFor: (intent: AnyIntent) => WriteContext;
    /** Caller-supplied clock — the destructive grace comparison needs it. */
    readonly now: Date;
}

/**
 * safety.md §2.6 wants "the exact item and value the adapter may change".
 * The switch is exhaustive on purpose: a new catalogue operation fails to
 * compile here until someone states what it changes, which is the one
 * place that sentence can be enforced rather than hoped for.
 */
function describeChange(intent: AnyIntent): string {
    switch (intent.operation) {
        case "postManagedComment":
            return `managed comment ${intent.desired.marker}`;
        case "applyMappedLabel":
            return `add mapped meaning ${intent.desired.meaning}`;
        case "removeMappedLabel":
            return `remove mapped meaning ${intent.desired.meaning}`;
        case "unassign":
            return `unassign ${intent.desired.login}`;
    }
}

function writeRequestFor(intent: AnyIntent): WriteRequest {
    return {
        actionClass: intent.actionClass,
        capability: intent.capability,
        causeObservedAt: intent.cause.observedAt,
        cause: intent.cause.cause,
        target: {
            item: `${intent.repository.owner}/${intent.repository.repo}#${String(intent.item.number)}`,
            change: describeChange(intent),
        },
    };
}

/**
 * contract.md §5 allows a multi-call plan; every catalogue operation is
 * one call today, so this is one call long and honest about why.
 *
 * FINDING(planner-per-call-idempotency): `IntentDeclaration` carries ONE
 * idempotency class, but `PlannedCall` carries one PER CALL — and a
 * multi-call plan mixes them (create-comment then add-label is
 * non-idempotent then idempotent). The declaration's single class is
 * therefore not expressive enough for the plans contract.md §5 permits.
 * It holds only while every operation is single-call, which is true now
 * and is the reason this is a recorded constraint rather than a defect:
 * the first multi-call operation must move the class from the intent
 * declaration onto the call, or plans will retry under the wrong rule.
 *
 * The class comes from the catalogue via `idempotencyOf`, never from the
 * declaration — FINDING(runtime-idempotency-declared-not-checked).
 */
function callsFor(intent: AnyIntent): readonly PlannedCall[] {
    return [
        {
            seq: 1,
            intent: intent.operation,
            idempotencyClass: idempotencyOf(intent.operation),
        },
    ];
}

/**
 * Translate one batch of intents from one capability.
 *
 * **One intent, one plan.** contract.md never says whether a capability's
 * several intents form one plan or several, and the executor claims per
 * `effectId`, so the choice is load-bearing. Separate plans, because a
 * shared one would couple unrelated outcomes three ways: a crash mid-plan
 * blocks the siblings behind a claim they have no relationship to; D45's
 * revision guard invalidates the whole plan when configuration changes,
 * discarding intents that were still valid; and the journal's contiguous
 * `seq` would impose an order the capability never asked for. Grouping is
 * recoverable later if some capability needs atomic ordering; ungrouping
 * a shared plan after the fact is not.
 */
export function planIntents(
    intents: readonly AnyIntent[],
    inputs: PlanningInputs,
): PlanningResult {
    const dispositions: Disposition[] = [];
    const keys = new Map<string, AnyIntent>();

    for (const intent of intents) {
        const screen = screenIntent(intent, inputs.declaration);
        if (!screen.ok) {
            dispositions.push({
                kind: "refuse",
                intent,
                code: screen.code,
                reason: screen.reason,
            });
            continue;
        }
        /**
         * FINDING(planner-key-collision): two intents sharing an
         * `idempotencyKey` are ONE effect to the store, so the second is
         * read as already-done and never performed — a silently dropped
         * write, not an error. Detected here, at the only point where a
         * whole batch is visible at once; the store cannot see it,
         * because from its side the pair is indistinguishable from a
         * legitimate redelivery.
         */
        const clash = keys.get(intent.idempotencyKey);
        if (clash !== undefined) {
            dispositions.push({
                kind: "refuse",
                intent,
                code: "duplicateIdempotencyKey",
                reason: `shares an idempotency key with the earlier "${clash.operation}" intent — the store would treat them as one effect`,
            });
            continue;
        }
        keys.set(intent.idempotencyKey, intent);

        const context = inputs.contextFor(intent);
        if (context.mode !== inputs.mode) {
            dispositions.push({
                kind: "refuse",
                intent,
                code: "modeMismatch",
                reason: `the rechecked context says mode "${context.mode}" but the reviewed configuration says "${inputs.mode}" (FINDING(planner-mode-duplicated))`,
            });
            continue;
        }
        const request = writeRequestFor(intent);
        const verdict =
            intent.actionClass === "clockTriggeredDestructive" &&
            intent.destructive !== undefined
                ? evaluateDestructive(
                      {
                          request,
                          /**
                           * Rebuilt from the STORED warned cause, never
                           * from `request` — see
                           * FINDING(runtime-warning-cannot-cross-the-store).
                           * Building it from the current request would
                           * make D60's snapshot comparison compare a
                           * value with itself.
                           */
                          warning: createDestructiveWarning({
                              request: {
                                  ...request,
                                  cause: intent.destructive.warnedCause,
                                  causeObservedAt:
                                      intent.destructive.warnedCauseObservedAt,
                              },
                              warnedAt: intent.destructive.warnedAt,
                              gracePeriodDays: intent.destructive.gracePeriodDays,
                              earliestActionAt: intent.destructive.earliestActionAt,
                              cancelledBy: intent.destructive.cancelledBy,
                              reversesWith: intent.destructive.reversesWith,
                          }),
                          qualifyingActivitySinceWarning:
                              intent.destructive.qualifyingActivitySinceWarning,
                      },
                      context,
                      inputs.now,
                  )
                : evaluateWrite(request, context);

        switch (verdict.outcome) {
            case "refuse":
                dispositions.push({
                    kind: "refuse",
                    intent,
                    code: verdict.code,
                    reason: verdict.reason,
                });
                break;
            case "record-only":
                /**
                 * Dry-run and observe stop HERE, before a plan exists —
                 * not at the port. An unapplied plan would still be
                 * journalled, and the recovery loop would later find an
                 * open intent it is obliged to resolve against GitHub for
                 * a write that was never meant to happen. Rule 10 is a
                 * planning decision, not an execution one.
                 */
                dispositions.push({
                    kind: "record",
                    intent,
                    code: verdict.code,
                    reason: verdict.reason,
                });
                break;
            case "apply":
                dispositions.push({
                    kind: "plan",
                    intent,
                    plan: {
                        effectId: intent.idempotencyKey,
                        revision: inputs.revision,
                        calls: callsFor(intent),
                    },
                });
                break;
        }
    }

    return {
        dispositions,
        plans: dispositions.flatMap((d) => (d.kind === "plan" ? [d.plan] : [])),
    };
}
