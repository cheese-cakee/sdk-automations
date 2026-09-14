# automation-core — pure logic

Everything between a delivery and a verdict, with no I/O anywhere: the normalizer, the workflow map,
the capability boundary, the safety ladder, and the report. It imports no workspace neighbour — its
tests may reach the testkit — and it opens no socket, file or timer.

**The entry point is one verb.** A shell hands `decide()` the facts, the parsed configuration, the
enabled capabilities, and the few facts core cannot know: the clock, the kill switch, the
installation's grants, human edit ordering, and the warning already recorded for an effect. Back come
a report and the approved intents. Core decides; it never acts.

The tree — what each directory owns, and the lock that holds core's directions — is
[`design/architecture.md`](../../design/architecture.md) §1; the words it is written in, and the
route through the whole platform, are [`design/trace.md`](../../design/trace.md). Each directory's
`index.ts` header is its own documentation. Read [`test/slice.test.ts`](test/slice.test.ts) first:
one real captured delivery, payload to report, runnable in seconds.

```bash
pnpm --filter @hiero-hackers/automation-core test
```
