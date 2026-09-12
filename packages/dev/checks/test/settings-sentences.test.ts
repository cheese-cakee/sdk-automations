/**
 * Every setting a repository may write says what it is for.
 *
 * A spec's keys are the legal names, and until `describe()` there was nowhere
 * to put the sentence that says what a key means — so `docs/capabilities.md`
 * listed key names, and every explanation lived in hand prose beside the spec
 * or in `docs/examples/full.yml`'s comments, where nothing compared the two.
 * The sentence now travels with the field, and this is the check that a shipped
 * capability cannot add a key and leave a maintainer to guess.
 *
 * A repository check rather than a core one: it reads the capabilities package
 * through `CAPABILITIES`, which is reach core does not have (D85).
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
import { shippedCapabilities } from "./capabilities.js";

/** Every field of a described spec at its dotted path — groups and leaves alike. */
function everyField(
    fields: Readonly<Record<string, FieldDescription>>,
    path = "",
): readonly (readonly [string, FieldDescription])[] {
    return Object.entries(fields).flatMap(([key, field]) => {
        const at = path === "" ? key : `${path}.${key}`;
        return [[at, field] as const, ...everyField(field.fields ?? {}, at)];
    });
}

/** The dotted keys nobody wrote a sentence for. */
function undocumented(fields: Readonly<Record<string, FieldDescription>>): string[] {
    return everyField(fields)
        .filter(([, field]) => field.doc === null)
        .map(([at]) => at);
}

describe("every shipped setting says what it is for", () => {
    it.each(shippedCapabilities().map(({ name, settings }) => [name, settings] as const))(
        "%s",
        (_name, settings) => {
            expect(undocumented(describeSpec(settings))).toEqual([]);
        },
    );

    // A walk that stopped at the top would pass every spec above vacuously.
    it("reaches the bottom of the deepest shipped spec", () => {
        const inactivity = shippedCapabilities().find(({ name }) => name === "inactivity");
        const walked = everyField(describeSpec(inactivity?.settings ?? {})).map(([at]) => at);
        expect(walked).toContain("pullRequests.reapWhen.needsRevision.reap.after");
    });

    it("names the dotted key of a setting nobody described, at whatever depth it sits", () => {
        const halfWritten = spec({
            announce: flag({ default: false, doc: "Say so in a comment" }),
            issues: block({ remindAfter: duration({ default: "14d" }) }, { doc: "Run the ladder" }),
        });
        expect(undocumented(describeSpec(halfWritten))).toEqual(["issues.remindAfter"]);
    });
});

/**
 * A capability's block is flat, so `enabled` is consent at the top of it and no
 * spec may also declare it as a setting. Read here beside the sentence check
 * because both ask the same question of a shipped spec's keys — and a shipped
 * capability is the one place the rule could be broken without a boot.
 */
describe("no shipped capability declares the reserved key", () => {
    it.each(shippedCapabilities().map(({ name, settings }) => [name, settings] as const))(
        "%s",
        (_name, settings) => {
            expect(Object.keys(settings)).not.toContain("enabled");
        },
    );

    // The negative control: the assertion above passes vacuously if the keys
    // it reads are not a spec's own.
    it("catches a spec that declares it", () => {
        const reserved = spec({ enabled: flag({ default: false, doc: "Consent, wrongly a key" }) });
        expect(Object.keys(reserved)).toContain("enabled");
    });
});
