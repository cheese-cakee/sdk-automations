# Test Strategy for the GitHub App Platform

> The test strategy must prove capability isolation, GitHub adapter behavior, effect recovery, configuration
> safety, and rollout controls. Specific frameworks will be selected with the implementation.

## 1. Test boundary

Capabilities are tested against platform interfaces that this project owns. GitHub response shapes are
handled and tested at one adapter boundary.

This design preserves the strong per-handler testing found in the C++ automation while adding tests for the
seams that the old system could not verify. It avoids giving every capability a separate hand-written model
of GitHub.

## 2. Test layers

| Layer | What the layer proves | External dependency |
|---|---|---|
| Pure platform logic | Configuration merging, policy, compatibility, safety, and intent validation behave deterministically. | The layer has no external dependency. |
| Capability unit | One capability produces the expected intent from normalized observations and its own configuration. | The layer uses owned platform fakes. |
| Capability conformance | The capability cannot use undeclared configuration, resolvers, intents, permissions, or sibling capabilities. | The layer uses the registry and type boundary. |
| Adapter contract | Normalized reads and narrow writes match GitHub's documented and recorded behavior. | The layer uses recorded GitHub fixtures and selected sandbox calls. |
| Effect recovery | Duplicate delivery, unclear responses, partial multi-call effects, restarts, and concurrent human edits converge safely. | The layer uses the real executor with controlled adapter failures. |
| Configuration integration | Default-branch loading, strict YAML validation, dormant settings, schema errors, effective values, permission mismatch, and rollback behave safely. | The layer uses repository fixtures and sandbox configuration changes. |
| Composition | Supported capability combinations preserve declared compatibility and ownership rules. | The layer uses the real platform and a fake adapter. |
| End-to-end sandbox | The GitHub App installation, webhook, token, API, configuration, storage, and recovery path work together. | The layer uses a development App and personal sandbox. |
| Replay and shadow | A new version evaluates recorded or live read-only observations without unexplained differences. | The layer uses sanitized audit records or approved shadow traffic. |

## 3. Capability conformance kit

The kit derives tests from the capability declaration.

- The kit verifies that disabled capabilities receive no events or schedules.
- The kit verifies that only the declared configuration is visible.
- The kit verifies that undeclared resolvers and intents are unavailable.
- The kit verifies that missing permissions prevent writes.
- The kit verifies dry-run output for every declared intent.
- The kit verifies repeated observations without duplicate effects.
- The kit verifies stale expectations and newer human changes.
- The kit verifies capability-specific disablement and rollback.
- The kit verifies every declared compatibility rule.

Passing the conformance kit shows that the capability follows the platform contract. It does not prove that
the capability policy is desirable. Maintainer review and capability-specific tests provide that evidence.

## 4. Adapter fixtures

The project should record real GitHub payloads and API responses from approved sandbox traffic. Every fixture
records the source endpoint, event, API version, capture date, sanitization, and expected normalization.

Hand-written fixtures remain acceptable for impossible or security-sensitive fault injection when the test
clearly identifies them as synthetic. The suite must not pretend that a synthetic fixture proves real GitHub
behavior.

The adapter suite must cover pagination, `null` and missing fields, redirects, conditional reads, rate-limit
headers, secondary limits, validation errors, forbidden responses, timeouts, and lost responses after a write
may have succeeded.

## 5. Recovery matrix

Every multi-call effect is tested with failure after each call and before each verification read. The matrix
includes the following scenarios.

- The same webhook delivery arrives again.
- A different delivery describes the same current state.
- Events arrive out of order.
- GitHub applies a write but the response is lost.
- The process stops before recording progress.
- The process stops after recording progress but before the next call.
- A human makes the same change while the App is stopped.
- A human makes an opposing change while the App is stopped.
- A permission is removed during recovery.
- The mapped label or managed comment is renamed, edited, or deleted.
- Two executor processes attempt the same or opposing effects when the selected hosting model permits that
  scenario.

The expected result must be `applied`, `already`, `conflict`, `forbidden`, `retryLater`, or `unknown`. The
test fails when the executor guesses success from an API response without verifying the postcondition.

## 6. Configuration matrix

The configuration suite covers absent, empty, valid, invalid, unknown-key, outdated, and future-version
files. It covers default-branch changes, pull-request-only changes, disabled capabilities with dormant
settings, mapping conflicts, missing or renamed labels, missing fields, missing permissions, mode changes,
and rollback.

The suite proves that no configuration and invalid configuration cause no workflow-changing writes. It also
proves that every capability remains off when omitted or explicitly disabled, including when a workflow
profile provides settings.

## 7. Security tests

The security suite covers invalid webhook signatures, replayed deliveries, command spam, forged markers,
untrusted mentions and markup, oversized configuration, permission reduction, queue saturation, and secret
redaction.

The App never runs pull request code with its write credentials. Fork and private-repository behavior is
tested with the development App before the corresponding capability is offered.

## 8. Required checks by stage

| Stage | Required evidence |
|---|---|
| Every pull request | Pure logic, capability unit, conformance, configuration, security, and deterministic failure-injection tests must pass. |
| Release candidate | Adapter contracts, effect recovery, supported composition, migration, and replay tests must pass. |
| Personal sandbox | Real webhook, token, API, storage, disablement, and rollback tests must pass. |
| Hiero Hackers sandbox | Observe, dry-run, reversible-write, kill-switch, and clean-soak evidence must pass. |
| Volunteer pilot | Maintainer approval, shadow comparison, rollback rehearsal, and an agreed clean observation period are required. |

## 9. Verification tiers within a layer

The implementation packages established a progression of techniques, each proven to find defects the
previous tier could not (2026-07-25: three real bugs and roughly twenty test blind spots across `core/` and
`store/`). New platform code — the stage-five shell above all — applies the tiers as it is written, not
after.

1. **Example tests** state the specification case by case. They are the floor, not the goal.
2. **Exhaustive enumeration** replaces examples wherever the input space is finite and small: every safety
   context, every meaning subset, every transition triple. Enumeration is strictly stronger than sampling
   and removes the question "did we pick the right examples?" — but only for the dimensions it actually
   enumerates, so a sweep must NAME them. The safety sweep advertised itself as exhaustive over 384 contexts
   while holding the action class fixed at one of five values; the omitted dimension is exactly where D52
   lived, and 152 passing tests did not see it. A sweep that fixes an input is an example test wearing a
   sweep's name.
3. **Property-based tests** (fast-check, fixed seeds) cover the unbounded spaces with stated invariants:
   parsers never throw and are fixed points; identifiers round-trip unchanged; timestamp order is
   chronological order. Found the mixed-precision ordering bug that examples missed.
4. **Model-based interleaving** covers stateful components: a reference model beside the real component,
   hundreds of seeded random operation interleavings, equality asserted at every step. The current store
   operations are sequential, not simultaneous, and the executor's 64 scheduled histories are not 64
   exercised crash pairs (18 trigger both crashes, 30 one, 16 none). Future multi-call effects must
   enumerate reachable failure points, assert every requested fault fired, add live overlap, and assert
   convergence plus non-duplication.
5. **Mutation audits** (Stryker) measure whether the suite actually observes the code. CI runs them on
   every pull request and push for each package that owns a Stryker config — a deliberate cost, accepted
   2026-08-15 because the score is the standing proof behind every test-suite consolidation. Full
   surviving-mutant triage still happens at milestones where "the tests are the spec" is the claim under
   review: before stage-four ratification and before each pilot ring. Surviving mutants are triaged to a
   new test, or documented as provably equivalent.

Two standing rules from the same evidence: a fake used by tiers 2–4 must state where it is kinder than the
real dependency (see D46 — the crash grid's world answers reads with perfect consistency; GitHub does
not), and a test that compares a constant against itself proves nothing (assert literal shapes, not
self-equality).

## 10. Questions that remain open

- The implementation must choose the test frameworks and fixture storage format.
- The project must define how sandbox records are sanitized and retained.
- The storage decision must determine database and queue integration tests.
- The hosting decision must determine process-overlap and deployment tests.
- The first capability must define policy-specific cases beyond the conformance kit.
- Maintainers must define the clean observation period for a pilot.
