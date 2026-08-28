# automation-adapter

**The only place in the platform that talks to GitHub.** Everything else decides; this asks and
answers. It sits on `core/` and on nothing else, and exactly one file outside it — the shell's
composition root — ever names it. Green tests mean agreement with the fixtures, not live GitHub;
the provenance table below records what was actually measured.
The build guide is [`design/guides/adapter.md`](../../design/guides/adapter.md); the
operation list and its costs are
[`design/findings/endpoint-permission-matrix.md`](../../design/findings/endpoint-permission-matrix.md).

## What is here today

| File | The question it answers |
|---|---|
| `jwt.ts` | What proves we are the App? |
| `token.ts` | What token may we call with, right now? |
| `http.ts` | How does every operation make one bounded, classified GitHub call? |
| `externals.ts` | Which of core's external facts does GitHub answer, live? |
| `mint.ts` | How is a token minted when no token exists yet? |
| `untrusted.ts` | How are GitHub's bytes read without trusting them? |

Every outside dependency — fetch, the clock, the mint call — is injected, so no test reaches the
network. The client exposes only the GET reads this stage has proved, pins credentials to GitHub's
HTTPS API origin, and refuses to follow redirects. Each file's header carries its own detail; read
them in the table's order.

## The trap this package exists around

**An expired token and a wrong private key return byte-identical 401 bodies** (`"Bad credentials"`,
observed 2026-07-23). Nothing in the response distinguishes them, so `isPastExpiry` is the local
fact `classifyFailure` needs to tell an expiry apart from a credential fault. A token cache that
only reacted to 401s would classify every expiry as a bad key.

## Provenance, and how each fact goes stale

Dated measurements of a live system; D40 makes re-probing standing rather than occasional. Rows
without a probe date hold **documented** knowledge — things GitHub publishes and would announce
changing — so they are here for coverage, not for the quarterly pass.

| Fact | Where it lives | Probed by | Date | Goes stale when | First symptom |
|---|---|---|---|---|---|
| JWT span ≤ 600 s from `iat` | `ASSERTION_LIFETIME_SECONDS` | GitHub's docs | documented | the cap changes | every mint 401s at once — loud |
| RS256, backdated `iat` | `jwt.ts` | GitHub's docs | documented | the signing scheme changes | every mint rejected — loud |
| Installation token TTL is 1 h | `REFRESH_SKEW_SECONDS`, `MINT_FLOOR_SECONDS` | matrix row, mint response | 2026-07-23 | GitHub shortens the TTL | **quiet if shortened below ~2 min**: the floor would serve genuinely dead tokens |
| Expiry and bad key share a 401 body | `isPastExpiry`, and core's `classifyFailure` | experiment 6.1 | 2026-07-23 | GitHub distinguishes them | quiet — we keep using a local fact that became unnecessary |
| `permissions` is `{scope: level}` | `grantsFromPermissions` | mint response | 2026-07-23 | a level outside `read`/`write` enters the ceiling | **quiet**: the grant is dropped, and a capability refuses citing a permission the installation actually holds |
| REST request version is `2026-03-10` | `GITHUB_API_VERSION` | GitHub's version docs | documented | the version approaches sunset | response carries `deprecation`/`sunset`, then calls return 410 |
| Authenticated conditional GET returning 304 costs no primary quota | `http.ts` ETag cache | GitHub's best-practice docs, experiment 6.4 | documented + 2026-07-23 | GitHub changes conditional accounting | rate usage rises on unchanged reads |
| Mint answers 201 with `token`, `expires_at`, `permissions` | `mint.ts` | experiment 6.1, matrix row | 2026-07-23 | the response shape changes | unreadable token/expiry is transient; missing permissions grant nothing |
| Timeline entries name `event`, a typed `actor`, second-precision `created_at`; pages ascend | `externals.ts` six-kind filter | GitHub's timeline docs, matrix row | documented + 2026-07-23 | the shape or the kinds change | missing actor/date on a counted event is unknown; **quiet**: new kinds remain uncounted |

**The quiet rows are the ones that matter.** A wrong JWT bound fails loudly within minutes; a TTL
that shrank, a grant level silently dropped, or a timeline shape that drifted keeps every test
green while the running system misbehaves — and the timeline row is the worst of the three, because
its failure direction is writing over human edits. `MINT_FLOOR_SECONDS` is *derived* from the TTL
row — its safety argument is "an hour is far longer than a minute", and it stops being sound the
day that stops being true.

**Cadence:** quarterly for the dated rows, plus ad-hoc whenever a first-symptom column shows up in
operator reports. **Owner:** unassigned, the same unfilled row as its sibling in `core/`.

## Still to arrive

The remaining operations — one per confirmed matrix row, each adding only its URL and its parse
on top of `http.ts` — and the two seams still stubbed in the shell: `githubConfigSource` and the
resolvers. `design/guides/adapter.md` holds the order and what each one is blocked on.

## What keeps it honest

`pnpm --filter @hiero-hackers/automation-adapter test` typechecks and runs the suite. CI holds no
credential and neither does this package: every credential is untracked environment, supplied to
the composition root. Test fixtures are built lazily, never at collection time — the reason lives
in `test/harness.ts`'s header (D89).
