/**
 * What change does one intent make — spelled for the safety gate, and for the
 * rehearsal record?
 *
 * One recipe, two readers. `writeRequestFor` builds the request an intent is
 * judged by here at decision time AND in the shell's applier at apply time, so
 * a re-gate can never judge a differently-shaped request than the decision did.
 * `decide.ts` composes; this file only says what a change IS.
 *
 * No operation is named here. The wording of a change lives in that
 * operation's own module under `capability/operations/`, and the registry
 * those modules are listed in is the "adding an operation" checklist.
 */

import { INTENT_OPERATIONS, type AnyIntent, type IntentOperation } from "../capability/index.js";
import { OPERATIONS, type OperationModule } from "../capability/operations/index.js";
import type { WriteRequest } from "../safety/index.js";
import { finding, type Finding, type Subject } from "../report/index.js";

/**
 * contracts/safety.md requires the exact item and value an adapter may change.
 * The registry answers for every operation, so an operation with no module
 * fails to compile there rather than going unworded here.
 */
export function describeChange(intent: AnyIntent): string {
    // The registry's value and the intent both narrow on `intent.operation`,
    // but they narrow SEPARATELY: TypeScript checks the call against the union
    // of the three modules, whose parameters intersect to a `desired` no
    // single intent has. The cast correlates the pair the key already pairs —
    // both sides are indexed by this same `intent.operation` — and it is
    // written once here, the way `invoke.ts` argues `toEngine`.
    const module = OPERATIONS[intent.operation] as OperationModule<IntentOperation>;
    return module.describeChange(intent);
}

/**
 * The one recipe for the safety request an intent is judged by — used here
 * at decision time and by the shell's applier at apply time, so a re-gate
 * can never judge a differently-shaped request than the decision did. The
 * capability comes from the intent; the screen has already proved it names
 * its declaration. Core's slice parity test pins this builder as the
 * specification.
 */
export function writeRequestFor(intent: AnyIntent): WriteRequest {
    const facts = INTENT_OPERATIONS[intent.operation];
    return {
        capability: intent.capability,
        actionClass: facts.actionClassFloor,
        requiredPermissions: [facts.permission],
        cause: intent.cause.cause,
        causeObservedAt: intent.cause.observedAt,
        ...(intent.evaluatedAt === undefined ? {} : { evaluatedAt: intent.evaluatedAt }),
        target: {
            item: `${intent.repository.owner}/${intent.repository.repo}#${String(intent.item.number)}`,
            change: describeChange(intent),
        },
    };
}

/**
 * What dry-run would have done, said once per intent that got that far.
 *
 * This is the whole difference between the two record-only modes. `observe`
 * reports that a repository in a recording mode recorded; `dry-run` also names
 * the change, so the ladder's middle rung is a rehearsal an operator can read
 * before promoting the repository to `active` (safety rule 10's rollout half).
 *
 * It DESCRIBES rather than prepares. No managed identity is minted here and
 * none is minted anywhere else in this mode: a marker is the name a landed
 * write is found again under, and a write that will not happen has nothing to
 * find (D125). The change is spelled in `describeChange`'s words, so the
 * rehearsal and the active-mode safety record name the same change identically.
 */
export function wouldApplyFinding(intent: AnyIntent, subject: Subject): Finding {
    return finding(
        "info",
        "wouldApply",
        `dry-run: ${intent.capability} would ${intent.operation} on ` +
            `${intent.repository.owner}/${intent.repository.repo}#${String(intent.item.number)} — ` +
            `${describeChange(intent)}. Nothing was written.`,
        subject,
    );
}
