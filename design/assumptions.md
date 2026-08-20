# Assumptions

What the project believes about maintainers. The commitments these license are in
[`goals.md`](goals.md).

Each row is numbered so a decision row or an interview note can cite it. **Evidence today** records
what actually supports the belief right now — `none` means we are building on it anyway, which is the
point of writing it down. The maintainer-needs interviews are what fills that column in; until then,
a row with `none` is a risk, not a fact.

## Need — is the problem real, and is it the same problem everywhere?

| # | Assumption | What breaks if it is false | Evidence today |
|---|---|---|---|
| A1 | Maintainers want to focus on core tasks related to their repositories, rather than improving workflows. | The premise of a hosted App: if maintainers enjoy owning workflow code, per-repo Actions are already the right answer. | none — belief |
| A2 | Maintainers want a low-touch way of automating many of the repetitive tasks. | Justifies configuration over extension. A maintainer who wants to write logic wants a framework, not this. | none — belief |
| A3 | Maintainers have different preferences as to what repetitive tasks they want automated. | The whole opt-in capability model (P2, P3). If everyone wants the same set, a fixed suite is simpler and better. | **strong** — the three audited SDKs diverge sharply: C++ runs ten services, Python ~40 small workflows, JavaScript almost none ([`services.md`](audit/services.md), [`services-js.md`](audit/services-js.md)) |
| A4 | The load is real and recurring enough to be worth automating at all. | Everything. | **moderate** — two SDKs independently built and maintain bots for it ([`services.md`](audit/services.md)) |
| A5 | Maintainers want repository-health automation more than they want it to be free of a hosted dependency. | The hosted model itself; the alternative is a template repo of Actions they copy. | none — belief |

## Trust and adoption — will they actually install it?

| # | Assumption | What breaks if it is false | Evidence today |
|---|---|---|---|
| A6 | Maintainers require the App to use minimal permissions. | The permission ceiling and the refusal of `contents: write` ([`endpoint-permission-matrix.md`](findings/endpoint-permission-matrix.md)). | none — belief, though it is the safer error |
| A7 | Maintainers will grant a third-party hosted App write access to issues and pull requests at all. | Everything downstream of observe mode. The ceiling only matters if the answer is yes. | none — **the largest untested belief in the project** |
| A8 | Maintainers want to see what automation would do before it does it. | The `observe` → `dry-run` → `active` ladder. If they want value immediately, the ramp reads as friction. | none — belief |
| A9 | Maintainers want an explanation for every action, not silent success. | The findings, severities, and canonical report — a large share of the built system. | none — belief |
| A10 | At least one repository will volunteer for a reversible pilot (Q8). | Stage-eight soak and every gate past it. | none — no volunteer identified |

## The configuration model — will they run it this way?

| # | Assumption | What breaks if it is false | Evidence today |
|---|---|---|---|
| A11 | Maintainers will accept and maintain a reviewed YAML file in their repository. | The config-driven choice (P2, D93). | **weak** — C++ already maintains `hiero-automation.json` this way ([`services-cpp.md`](audit/services-cpp.md)) |
| A12 | Repositories will govern who may edit that file. | Safety. The file is as powerful as branch protection, and nothing in the App restrains who merges a change to it. | none — recorded as a documentation gap in [`to-do.md`](../docs/to-do.md) |
| A13 | Per-repository configuration is enough; no organization-level inheritance is needed in the first version. | The no-inheritance non-goal. Fails if repositories turn out to want one policy set centrally. | none — belief |
| A14 | Repositories express workflow state through labels that can be mapped to stable meanings (P7). | The whole mapping model and the meaning taxonomy. Fails if repositories move to Projects fields or custom statuses. | **strong** — every audited SDK drives its workflow from labels ([`labels-cpp.md`](audit/labels-cpp.md), [`labels-python.md`](audit/labels-python.md)) |
| A15 | Humans will keep editing labels, assignees, and state by hand, and automation must yield to them (P5). | The derived world, the manual-edit rules, and the newer-human-change refusal. | **strong** — the audits show manual entry paths throughout ([`services.md`](audit/services.md)) |

## Evolution — will it still be wanted later?

| # | Assumption | What breaks if it is false | Evidence today |
|---|---|---|---|
| A16 | Some maintainers will increase or decrease their involvement over time, so preferences should scale up and down easily. | Justifies per-capability toggles over a single on/off. | none — belief |
| A17 | No single capability will remain desirable; the App should evolve with changing needs. | Justifies the capability loop and the disposability of any one capability. | none — belief |
| A18 | AI use will increase, and the App's capabilities should be complementary to it or eventually offer such an option. | Long-term positioning; unaddressed by anything built so far. | none — belief |
| A19 | Maintainers will retire their existing bots rather than run both (Q7). | Migration. Two writers on the same managed state is the one thing the rules forbid outright. | none — belief, and the hardest to walk back if wrong |

## The operating model — will anyone run it?

| # | Assumption | What breaks if it is false | Evidence today |
|---|---|---|---|
| A20 | An organization will host, operate, and fund the App (Q1, Q13). | Production deployment. Nothing in the repository can substitute for an owner. | none — **unowned; the register has carried Q1 open since the beginning** |
| A21 | Organization governance will permit installation on the repositories that want it (Q11). | Reach. A per-repository install policy changes the rollout shape but not the design. | none — belief |

## What the interviews should settle

Six questions per repository, kept from the retired stage-two pack. Record answers per repository,
not per person — disagreement between repositories is signal (P7), not noise.

1. Which automation is essential to you today?
2. Which automation causes mistakes you have to clean up?
3. Which work still costs maintainer time that automation could take?
4. Which actions must always remain human?
5. Which permissions would be unacceptable for an installed App?
6. What is the smallest capability that would actually help you?

Question 5 tests A6 and A7 directly; question 6 tests A2 and A3; questions 1 and 3 test A1 and A4.
A19 needs its own question wherever an existing bot is in play: *would you turn yours off?*
