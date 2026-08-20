# Test Strategy for the GitHub App Platform

> **Partly built.** Pure logic, configuration parsing, capability isolation, durable intake/store
> concurrency, the HTTP-to-report slice, repository invariants, line coverage, and mutation gates run in CI.
> Adapter contracts, effect execution/recovery, real capabilities, rollout, and production operations do not
> exist yet and therefore cannot honestly be marked covered.

## 1. Current layers and gaps

| Layer | What exists now | What remains |
|---|---|---|
| Pure platform logic | Vitest examples, exhaustive matrices, and fast-check properties for configuration, workflow, capability screens, safety, engine, and reports | revise the candidate profile during stage-four review |
| Probe capability | unit tests for three disposable probes | replace probes with policy tests for the first real capability |
| Capability boundary | compile/runtime restriction tests and every-subset P3 engine matrix | no generic declaration-derived conformance kit; required meanings and settings schemas are missing |
| GitHub normalization | scrubbed real webhook fixtures exported by the testkit | more event kinds plus response fixtures for the adapter |
| Store | schema migrations, property/model tests, worker-thread races, crash interruption, atomic delivery/report completion | production retention, backups, lease-overlap contract, effect consumer |
| Shell | real HTTP, signature verify, durable accept before 202, config parse, core decision, atomic canonical report | default-branch config fetch, live grants/timeline/resolvers, scheduler, multi-repository routing, active writes |
| Repository | documentation vocabularies, links/citations, dependency graph, workflow security, package/test placement | add a focused invariant whenever a new closed claim appears |
| Adapter and effects | measured lab findings and build guides only | implementation, contract fixtures, postcondition verification, recovery, and rollback |
| Sandbox/pilot | feasibility protocols and one capture run | end-to-end adapter/effect rehearsal, clean soak, migration, rollback rehearsal |

The boundary rule is one GitHub model: capabilities consume normalized project-owned interfaces. They do not
carry private Octokit response fakes. Recorded external shapes belong in the testkit/adapter boundary, and
synthetic fault inputs must say where they are kinder or harsher than GitHub.

## 2. Configuration matrix

Built and covered:

- absent and empty files;
- valid YAML and every repository mode;
- malformed YAML, duplicate keys, excessive aliases, and non-mapping shapes;
- unknown keys, unsupported/missing schema versions, invalid mode and capability values;
- directly admitted versus unknown capability names, including disabled unknown names;
- invalid, unmappable, and non-injective label mappings;
- whole-file fail-closed behavior and a durable `configRejected` shell record;
- the tracked user examples parsing through the shell's core entry point.

Not covered because the implementation does not do it: pull-request config checks, default-branch fetching,
capability-specific settings validation, required-meaning validation, mapped-label existence, live permission
readiness, schema migration, rollback, and inheritance.

## 3. Capability and composition proof

Today this is several focused suites, not a generic “conformance kit”:

- declaration validation and catalogue admission in core;
- projected configuration/meaning visibility and resolver restriction at the typed boundary;
- runtime intent screens for identity, declared operation, cause, entity, pause, conflicts, and transitions;
- safety tests for config consent, installation grants, mode, pause, ordering, and preconditions;
- probe boundary tests plus an engine matrix over all eight subsets of three probes.

The matrix proves each enabled probe's approved intents and findings are unchanged by its neighbours, and a
disabled probe leaves no trace. It does not prove the probes are desirable, that effects converge, or that a
future capability's settings/ownership policy is valid.

A real capability must add cases for every decision branch, human override, redelivery, permission failure,
unknown resolver answer, projection conflict, disablement, and any capability-specific rollback.

## 4. Adapter fixtures

The lab captures only approved personal-sandbox traffic. `src/scrub.ts` deterministically removes account,
repository, database-id, node-id, email, description, and commit-SHA identifiers before bytes reach disk.
After a human reads the scrubbed file, it is promoted directly into
`packages/dev/testkit/fixtures/` with provenance.

The future adapter contract suite must cover:

- pagination, missing/null fields, redirects, and conditional reads;
- primary and secondary rate-limit signals and responses with no retry hint;
- forbidden, validation, suspension, timeout, and lost-response cases;
- the read-after-write asymmetry measured by protocol 6.7;
- permission and endpoint behavior from the checked matrix, with re-probe dates for perishable facts.

Hand-written fixtures remain appropriate for impossible or security-sensitive fault injection, but must be
labelled synthetic and cannot be cited as evidence of GitHub behavior.

## 5. Effect and recovery matrix — required, not yet implemented

Every future write operation must inject interruption before and after each remote call and verification
read. The matrix includes redelivery, reordered observations, a landed write with a lost response, process
exit before/after journal progress, same/opposing human edits, permission loss, renamed/deleted managed
objects, config revision change, and overlapping workers.

The oracle asserts postcondition and non-duplication, not merely a returned enum. An “absent” read that would
trigger a non-idempotent resend follows the two-read rule in
[`../findings/read-after-write.md`](../findings/read-after-write.md). The current store provides journal and
claim primitives, but there is no executor in this workspace and no test may imply otherwise.

## 6. Security coverage

Built checks cover invalid webhook signatures, duplicate delivery GUIDs, hostile/oversized YAML shapes,
prototype-pollution keys, action pinning, least-privilege workflow permissions, fork-safe CI triggers,
never-tracked credential/payload directories, dependency audit/review, and CodeQL.

Still required: command authorization/abuse, forged managed markers, hostile Markdown/mentions, live
permission reduction, queue saturation and tenant fairness, secret rotation, private-repository behavior,
adapter SSRF controls if outbound delivery is ever admitted, and active-write recovery.

## 7. Verification tiers

| Tier | Technique | Current use |
|---|---|---|
| 1 | examples | every module's readable floor |
| 2 | exhaustive enumeration | safety dimensions, meaning subsets, transition triples, capability subsets |
| 3 | property-based | fast-check parsers, identifiers, store histories |
| 4 | model/interleaving/concurrency | store reference model plus separately connected worker-thread races |
| 5 | mutation | Stryker per owning package with a config; CI matrix derived from those configs |

Enumeration is exhaustive only over dimensions it names. D52 survived an earlier “exhaustive” sweep because
action class was held fixed. Negative controls are therefore required for repository checks, and fault tests
assert that the requested fault actually fired.

The store suite includes sequential model histories **and** simultaneous worker-thread contention; neither
substitutes for the other. Future effect overlap needs its own remote-call oracle because a SQLite claim
cannot cancel an in-flight GitHub request (D41).

CI currently runs Vitest/TypeScript tests on Node 24 and 25, line-coverage gates for packages that declare
them, and Stryker for `core`, `probes`, `shell`, and `store`. Fast-check uses fixed seeds so a reproduced
counterexample is distinguishable from a load-dependent timeout.

## 8. Evidence required by rollout stage

| Stage | Minimum evidence |
|---|---|
| Every pull request | affected unit/property/model tests, repository invariants, typecheck, lint, format, line/mutation gates, security workflow checks |
| First adapter/effect pull request | contract fixtures, every failure result, postcondition checks, deterministic interruption matrix |
| Personal sandbox | real installation/token/API path, active reversible write, loss recovery, kill switch, rollback |
| Hiero Hackers sandbox | observe then dry-run then reversible active scope, migration inventory, clean soak |
| Volunteer pilot | maintainer approval, shadow comparison, rollback rehearsal, operator ownership and alerts |

## 9. Open decisions

- Hosting determines deployment-overlap, queue-pressure, failover, and operator-alert tests.
- Retention policy determines deletion/export/backup tests for the five-table SQLite store.
- The first real capability supplies policy-specific cases and decides what reusable conformance support is
  worth extracting afterward.
- Maintainers must define the clean observation period and exit criteria for each pilot ring.
- Adapter fixtures need a sanitization review and refresh cadence; the format and first storage location are
  already selected (testkit JSON fixtures), not open.
