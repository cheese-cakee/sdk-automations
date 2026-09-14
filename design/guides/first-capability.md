# Your first capability

An afternoon, one folder, and a green test at the end of every step. The capability built here posts
one notice when a pull request opens as a draft. It reads one fact group, asks nothing, and writes one
managed comment, which is the smallest shape that touches every part of the door. Everything an
author imports comes through `@hiero-hackers/automation-core/author`
(`packages/core/src/author/index.ts`); the route behind each step is `design/trace.md`.

## 1. The design page

Write the page as a file named for the capability under `design/guides/capabilities/`, where a design
is a proposal until it is approved to be built (D189), and add its row to the index beside it. The first line is the capability's name,
a spaced em-dash, and its one-sentence job; the four section headings below it are checked, so keep
them exactly:

```markdown
# draftNotice — when a pull request opens as a draft, say what happens when it leaves draft

## What the output looks like
## What the config looks like
## How it works
## Verified by
```

Fill the four sections the way `packages/capabilities/src/prQuality/design.md` does. Once the design
is approved, make `packages/capabilities/src/draftNotice/` and move the page in as `design.md`,
updating the index; from here on the page is the standard the code is held to.

```bash
pnpm --filter @hiero-hackers/automation-checks test
```

## 2. The settings

`settings.ts` is a spec: the keys a repository may write beside `enabled`, each with the sentence the
generated documentation prints. The vocabulary is `design/guides/capability-kits.md` §3.

```ts
import { flag, spec } from "@hiero-hackers/automation-core/author";

export const DRAFT_NOTICE_SETTINGS = spec({
    mentionAuthor: flag({ default: true, doc: "Address the notice to the pull request's author" }),
});
```

## 3. The capability

`capability.ts` holds the declaration and `evaluate`. The declaration names the trigger, the group it
reads, and what it may do; the platform fills the rest. Three guards are never written: a closed item
never arrives, an unanswered resolver ends the evaluation as skipped, and a label with no edge is
skipped. `readiness` is declared because the capability reads it, and boot refuses the declaration if
the `pull_request` producer did not read that group.

```ts
import { declareCapability, mentions, type Capability } from "@hiero-hackers/automation-core/author";
import { DRAFT_NOTICE_SETTINGS } from "./settings.js";

export const draftNoticeDeclaration = declareCapability({
    name: "draftNotice",
    triggers: [{ kind: "event", event: "pull_request" }],
    needs: ["readiness"],
    settings: DRAFT_NOTICE_SETTINGS,
    resolvers: [],
    intents: ["postManagedComment"],
});

export const draftNotice: Capability<typeof draftNoticeDeclaration> = {
    declaration: draftNoticeDeclaration,

    async evaluate(facts, config, platform) {
        if (!facts.readiness.draft) return [];
        const to = config.settings.mentionAuthor ? `${mentions([facts.author])} — ` : "";
        return [
            platform.intent({
                operation: "postManagedComment",
                desired: {
                    kind: "notice",
                    body: `${to}This pull request is a draft. Mark it ready for review when it is, and the checks will run.`,
                },
                cause: "pullRequestOpenedAsDraft",
                explain: "Told the author what a draft waits for.",
            }),
        ];
    },
};
```

State `cause`: it is part of the intent's identity, so the same occasion always builds the same effect
(D65). Claims are read off the record; name one only to narrow it. Put the sentence a contributor
reads in `messages.ts` once there is more than one.

```bash
pnpm --filter @hiero-hackers/automation-capabilities exec tsc --noEmit
```

## 4. The test

`capability.test.ts` drives `evaluate` through `handleFor`, the engine's own handle typed for your
declaration, over a record built the way the `pull_request` producer builds one. `factsFor` projects
the record to the declaration and refuses one whose declared group the producer left unread; a
capability that asks a resolver scripts the answer with `answering({ ok: true, value })`.

```ts
import { describe, expect, it } from "vitest";
import { handleFor, projectCapabilityView } from "@hiero-hackers/automation-core";
import { configEnabling, factsFor, webhookPullRequest } from "@hiero-hackers/automation-core/author/testing";
import { draftNotice, draftNoticeDeclaration } from "./capability.js";

const config = projectCapabilityView(
    draftNoticeDeclaration,
    configEnabling(["draftNotice"], [draftNoticeDeclaration]),
);
const evaluate = (draft: boolean) => {
    const facts = factsFor(draftNoticeDeclaration, webhookPullRequest({ readiness: { draft } }));
    return draftNotice.evaluate(facts, config, handleFor(draftNoticeDeclaration, facts));
};

describe("draftNotice", () => {
    it("says nothing about a pull request that is ready", async () => {
        expect(await evaluate(false)).toEqual([]);
    });

    it("posts one notice to a draft's author", async () => {
        const [intent] = await evaluate(true);
        expect(intent?.operation).toBe("postManagedComment");
        expect(intent?.desired.body).toContain("@opener");
    });
});
```

```bash
pnpm format && pnpm --filter @hiero-hackers/automation-capabilities test
```

`pnpm format` first, every time: the formatter's line width is narrower than an editor's, and
`format:check` runs with the suite.

## 5. Register it

Two edits in `packages/capabilities/src/index.ts`: import the capability and add it to
`CAPABILITIES`, in the position the shell should run it. Enable it in `docs/examples/full.yml`, which
the suite holds to "every shipped capability on", and add the one-line entry to
`packages/capabilities/README.md`. Then regenerate what the registry feeds:

```bash
pnpm contracts
```

That rewrites `docs/capabilities.md`, the editor schema, and each example's committed parsed value.
`packages/dev/checks/test/examples.test.ts` names the command when a pin moves.

## 6. Everything, once

```bash
pnpm -r test
```

The matrix in `packages/capabilities/test/engine-matrix.test.ts` now runs the capability alone and
beside every other, at its spec's fullest valid settings, and the citation and design-page checks
read the folder. One pin there is hand-written on purpose: the list of managed comments the four
fixture records earn, in record then registry order. A capability that posts a comment adds its
rows, and the failure names the rule. Green here is the capability shipped. Mutation testing is
CI's; do not run it locally.

## When the platform lacks a word

A resolver the capability needs and the catalogue does not hold is one file in the adapter
(`packages/runtime/src/adapter/reads/`), and the compiler names every place it must be read. A fact
group is a platform change first, across core, the runtime and every fixture, because a fact is a
confirmed GitHub read; write the finding before the capability. `design/trace.md` step 6 prices each.
