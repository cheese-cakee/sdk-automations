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
    INTENT_OPERATIONS,
    MAPPABLE_MEANINGS,
    finding,
    screenFinding,
    verdictFinding,
    type Finding,
    type RepositoryRef,
    type Report,
    type SafetyRefusalCode,
    type Subject,
    evaluateDestructive,
    evaluateWrite,
    idempotencyOf,
    screenIntent,
    type AnyIntent,
    type IntentScreenRefusalCode,
    type RecordOnlyCode,
    type RepositoryConfig,
    type TypedDeclaration,
    type WriteContext,
    type WriteRequest,
} from "@hiero-hackers/automation-core";
import type {
    AdapterCommand,
    ConfiguredLabel,
    EffectPlan,
    PlannedCall,
} from "./recovery.js";

export const PLANNER_REFUSAL_CODES = [
    "duplicateIdempotencyKey",
    "mappedLabelMissing",
    "mixedRepositoryBatch",
] as const;

export type PlannerRefusalCode = (typeof PLANNER_REFUSAL_CODES)[number];

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
          readonly origin: "safety";
          readonly intent: AnyIntent;
          readonly code: SafetyRefusalCode;
          readonly reason: string;
      }
    | {
          readonly kind: "refuse";
          readonly origin: "intent-screen";
          readonly intent: AnyIntent;
          readonly code: IntentScreenRefusalCode;
          readonly reason: string;
      }
    | {
          readonly kind: "refuse";
          readonly origin: "planner";
          readonly intent: AnyIntent;
          readonly code: PlannerRefusalCode;
          readonly reason: string;
      };

export interface PlanningResult {
    /** Authoritative provenance captured from the inputs that produced this pass. */
    readonly repository: RepositoryRef;
    readonly mode: RepositoryConfig["mode"];
    readonly revision: RepositoryConfig["revision"];
    /** One entry per input intent, in order — nothing is dropped silently. */
    readonly dispositions: readonly Disposition[];
    /** The `plan` dispositions' plans, for handing to `RecoveryExecutor`. */
    readonly plans: readonly EffectPlan[];
}

export interface PlanningInputs {
    readonly declaration: TypedDeclaration;
    /** The one repository this planning batch belongs to. */
    readonly repository: RepositoryRef;
    /**
     * The reviewed configuration itself — not a copy of its mode.
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
     * declares its choices in a reviewed file"). D73 finished the job the
     * `modeMismatch` guard started: the safety engine now reads mode and
     * enablement from the configuration directly, so there is no second
     * copy to disagree with and no comparison left to make.
     */
    readonly config: RepositoryConfig;
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
            // "set", not "add": the adapter swaps the previous position
            // label as part of realising this (D4, D80).
            return `set mapped position ${intent.desired.meaning}`;
        case "unassign":
            return `unassign ${intent.desired.login}`;
    }
}

function writeRequestFor(intent: AnyIntent): WriteRequest {
    return {
        actionClass: intent.actionClass,
        capability: intent.capability,
        // From the catalogue, which owns what an operation needs (D62).
        requiredPermissions: [INTENT_OPERATIONS[intent.operation].permission],
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
function configuredLabels(config: RepositoryConfig): readonly ConfiguredLabel[] {
    return MAPPABLE_MEANINGS.flatMap((meaning) => {
        const label = config.mappings.labels[meaning];
        return label === undefined ? [] : [{ meaning, label }];
    });
}

function commandFor(
    intent: AnyIntent,
    config: RepositoryConfig,
): AdapterCommand {
    const common = {
        repository: { ...intent.repository },
        item: { ...intent.item },
        configurationRevision: config.revision,
        expected: {
            meaningsPresent: [...intent.expected.meaningsPresent],
            meaningsAbsent: [...intent.expected.meaningsAbsent],
            closed: intent.expected.closed,
        },
        configuredLabels: configuredLabels(config),
    };

    switch (intent.operation) {
        case "postManagedComment":
            return {
                ...common,
                operation: intent.operation,
                desired: { ...intent.desired },
                readBack: { kind: "managedCommentMarker" },
            };
        case "applyMappedLabel": {
            const label = config.mappings.labels[intent.desired.meaning];
            if (label === undefined) {
                throw new TypeError(
                    `cannot translate unmapped meaning "${intent.desired.meaning}"`,
                );
            }
            return {
                ...common,
                operation: intent.operation,
                desired: { meaning: intent.desired.meaning, label },
                readBack: { kind: "mappedLabel" },
            };
        }
        case "unassign":
            return {
                ...common,
                operation: intent.operation,
                desired: { ...intent.desired },
                readBack: { kind: "assigneeAbsent" },
            };
    }
}

function callsFor(
    intent: AnyIntent,
    config: RepositoryConfig,
): readonly PlannedCall[] {
    return [
        {
            seq: 1,
            command: commandFor(intent, config),
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

    const repository = { ...inputs.repository };
    const buildResult = (): PlanningResult => ({
        repository,
        mode: inputs.config.mode,
        revision: inputs.config.revision,
        dispositions,
        plans: dispositions.flatMap((d) => (d.kind === "plan" ? [d.plan] : [])),
    });

    const mixedRepository = intents.some(
        (intent) =>
            intent.repository.owner !== inputs.repository.owner ||
            intent.repository.repo !== inputs.repository.repo,
    );
    if (mixedRepository) {
        const targets = [
            ...new Set(
                intents.map(
                    (intent) => `${intent.repository.owner}/${intent.repository.repo}`,
                ),
            ),
        ].join(", ");
        for (const intent of intents) {
            dispositions.push({
                kind: "refuse",
                origin: "planner",
                intent,
                code: "mixedRepositoryBatch",
                reason: `the batch is scoped to ${inputs.repository.owner}/${inputs.repository.repo}, but its intents target ${targets}; no intent was planned`,
            });
        }
        return buildResult();
    }

    for (const intent of intents) {
        const screen = screenIntent(intent, inputs.declaration);
        if (!screen.ok) {
            dispositions.push({
                kind: "refuse",
                origin: "intent-screen",
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
                origin: "planner",
                intent,
                code: "duplicateIdempotencyKey",
                reason: `shares an idempotency key with the earlier "${clash.operation}" intent — the store would treat them as one effect`,
            });
            continue;
        }
        keys.set(intent.idempotencyKey, intent);

        if (
            intent.operation === "applyMappedLabel" &&
            inputs.config.mappings.labels[intent.desired.meaning] === undefined
        ) {
            dispositions.push({
                kind: "refuse",
                origin: "planner",
                intent,
                code: "mappedLabelMissing",
                reason: `meaning "${intent.desired.meaning}" has no configured label, so no adapter command can represent its desired state`,
            });
            continue;
        }

        const context = inputs.contextFor(intent);
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
                      inputs.config,
                      context,
                      inputs.now,
                  )
                : evaluateWrite(request, inputs.config, context);

        switch (verdict.outcome) {
            case "refuse":
                dispositions.push({
                    kind: "refuse",
                    origin: "safety",
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
                        revision: inputs.config.revision,
                        calls: callsFor(intent, inputs.config),
                    },
                });
                break;
        }
    }

    return buildResult();
}

/**
 * A planning pass as findings — the step that makes dry-run OBSERVABLE.
 *
 * D68 stops dry-run at planning and emits `record` dispositions, which was
 * correct and, until now, invisible: nothing collected them, so the mode
 * whose whole promise is "see what it would do" showed nothing. This is the
 * conversion, and it lives here rather than in `core/` because `Disposition`
 * is the executor's type and core must not depend on the executor.
 *
 * The severities follow core's rule, not a second one: a plan is `info`
 * because it is the system working, a record is `notice` because nothing
 * happened and that was intended, and a refusal is classified by core's own
 * table wherever the code came from a safety verdict.
 */
export function planningFindings(
    result: PlanningResult,
): readonly Finding[] {
    return result.dispositions.map((d) => {
        const subject: Subject = {
            kind: "effect",
            capability: d.intent.capability,
            item: d.intent.item,
            operation: d.intent.operation,
        };
        if (d.kind === "plan") {
            return finding(
                "info",
                "planned",
                d.intent.explanation.summary,
                subject,
                d.intent.explanation.detail,
            );
        }
        if (d.kind === "record") {
            return finding("notice", d.code, d.reason, subject, [
                d.intent.explanation.summary,
            ]);
        }
        switch (d.origin) {
            case "safety":
                return verdictFinding(
                    { outcome: "refuse", code: d.code, reason: d.reason },
                    subject,
                );
            case "intent-screen":
                return screenFinding(
                    { ok: false, code: d.code, reason: d.reason },
                    subject,
                );
            case "planner":
                return plannerRefusalFinding(d, subject);
        }
    });
}

function plannerRefusalFinding(
    disposition: Extract<Disposition, { readonly origin: "planner" }>,
    subject: Subject,
): Finding {
    switch (disposition.code) {
        case "duplicateIdempotencyKey":
            return finding("problem", disposition.code, disposition.reason, subject);
        case "mappedLabelMissing":
            return finding("problem", disposition.code, disposition.reason, subject);
        case "mixedRepositoryBatch":
            return finding("problem", disposition.code, disposition.reason, {
                kind: "repository",
            });
    }
}

/** The whole pass as a report, ready for a shell to render. */
export function planningReport(
    result: PlanningResult,
): Report {
    return {
        revision: result.revision,
        mode: result.mode,
        repository: result.repository,
        findings: planningFindings(result),
    };
}
