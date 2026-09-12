/**
 * Every key a shipped spec admits carries a sentence a maintainer can read.
 *
 * The repository-level rule is `packages/dev/checks/test/settings-sentences.test.ts`
 * and it stays there. What it cannot do is run in this package's mutation
 * sandbox, which runs one package's own suite — so an emptied `doc:`, or a
 * dropped options object, has nothing here to notice it. Hence the same walk.
 */

import { describe, expect, it } from "vitest";
import {
    block,
    describeSpec,
    duration,
    flag,
    spec,
    type FieldDescription,
} from "@hiero-hackers/automation-core";
import { CAPABILITIES } from "../src/index.js";

/**
 * The shortest a `doc` may be and still be a sentence about a setting.
 *
 * The floor is what the checks-package rule does not state: it asks whether a
 * sentence is THERE, and a key described in one word reads as no key described.
 */
const SENTENCE_FLOOR = 20;

/** Every field of a described spec at its dotted key — groups and leaves alike. */
function everyField(
    fields: Readonly<Record<string, FieldDescription>>,
    path = "",
): readonly (readonly [string, FieldDescription])[] {
    return Object.entries(fields).flatMap(([key, field]) => {
        const at = path === "" ? key : `${path}.${key}`;
        return [[at, field] as const, ...everyField(field.fields ?? {}, at)];
    });
}

/** The dotted keys whose sentence is absent, or too short to be one. */
function unwritten(fields: Readonly<Record<string, FieldDescription>>): string[] {
    return everyField(fields)
        .filter(([, field]) => typeof field.doc !== "string" || field.doc.length < SENTENCE_FLOOR)
        .map(([at]) => at);
}

describe("every shipped setting says what it is for", () => {
    it.each(
        CAPABILITIES.map(({ declaration }) => [declaration.name, declaration.settings] as const),
    )("%s", (_name, settings) => {
        expect(unwritten(describeSpec(settings))).toEqual([]);
    });

    // A walk that stopped at the top would pass every spec above vacuously.
    it("reaches the bottom of the deepest shipped spec", () => {
        const inactivity = CAPABILITIES.find(
            ({ declaration }) => declaration.name === "inactivity",
        );
        const walked = everyField(describeSpec(inactivity?.declaration.settings ?? {})).map(
            ([at]) => at,
        );

        expect(walked).toContain("pullRequests.reapWhen.needsRevision.reap.after");
    });

    /** The negative control, in the three spellings an unwritten sentence takes. */
    it("names the dotted key of an unwritten sentence, at whatever depth it sits", () => {
        const halfWritten = spec({
            announce: flag({ default: false, doc: "Say so in a comment on the issue" }),
            issues: block(
                { remindAfter: duration({ default: "14d", doc: "" }) },
                { doc: "Run the ladder on assigned issues" },
            ),
            pullRequests: block({ remindAfter: duration({ default: "14d", doc: "Silence" }) }, {}),
        });

        expect(unwritten(describeSpec(halfWritten))).toEqual([
            "issues.remindAfter",
            "pullRequests",
            "pullRequests.remindAfter",
        ]);
    });
});
