/**
 * The safety layer: may this write happen? If you are asking why a write was
 * refused, `rules.ts` is the file.
 *
 * `write.ts` is the general entry point; `destructive.ts` holds the §3
 * warning and grace gates that clock-triggered actions pass INSTEAD, not as
 * well (D52). `rules.ts` holds the general rules both entry points share. Only
 * their ORDER is exported, because D52 was a precedence defect.
 *
 * TWO DOORS, ON PURPOSE, and the asymmetry is information: the general path
 * has almost no special policy and the clock-triggered one is almost entirely
 * special policy. Do not merge them, and do not treat them as interchangeable
 * — handing a `clockTriggeredDestructive` request to `evaluateWrite` is
 * REFUSED, because a headline claim that was true only if the caller picked
 * the right function is a calling convention rather than a property (D52). The
 * answer is always a verdict — applied, recorded, or refused with a
 * machine-readable code — never an exception.
 *
 * WHAT CANNOT BE FAKED: where a claim would otherwise be taken on trust, the
 * trusted value is impossible to construct. `DerivedWorld` has no public
 * constructor and its brand is not exported, so outside this package there is
 * exactly one way to obtain a world — derive it from the observation you were
 * given (D92). `DestructiveWarning` works the same way, carrying an immutable
 * snapshot of the request it authorises, so it cannot be reused across a
 * different capability, item, change or cause (D60).
 *
 * ORDER IS CONTRACT, because precedence decides which code a maintainer sees.
 * `evaluatePreflight` checks the kill switch and authoritative precondition
 * availability before either door applies its own policy; `GENERAL_RULES` is
 * the rest of the ordered list. Each rule carries its SCOPE, and
 * `evaluateStandingRules` runs the kill switch plus the `standing` subset for
 * a caller that holds no item — the write path's resume gate, and the one
 * reason that function is public.
 */
export * from "./types.js";
export { evaluateWrite } from "./write.js";
// The rule ORDER is contract (D39, D52), so the list is public for tests to
// assert directly. The rules themselves stay internal, with one exception:
// `evaluateStandingRules` runs the item-independent subset for a caller that
// holds no item — the write path's resume gate, which would otherwise restate
// them.
export { evaluateStandingRules, GENERAL_RULES, type RuleScope } from "./rules.js";
export * from "./destructive.js";
/**
 * The derived world (D92 phase 4): the type, the derivation, and its two
 * ingredients — but never `DERIVED` (the brand) or `assertedWorld` (the
 * rule-suite constructor). Outside this package there is exactly one way
 * to make a world: derive it.
 */
export {
    deriveWorld,
    expectedHolds,
    observedMeaningsOf,
    type ClaimedFacts,
    type DerivedWorld,
} from "./world.js";
