/**
 * The one thing the platform knows about who is acting: a GitHub App's login
 * carries the `[bot]` suffix.
 *
 * Small enough to look obvious, and it is not: two layers answer
 * `isAutomationActor` with it — the adapter's live resolver source and the
 * shell's credential-free one — so the suffix told twice would be two facts
 * that could disagree. The suffix must END the login, because a person who
 * chose an awkward name is still a person.
 */

import { describe, expect, it } from "vitest";
import { AUTOMATION_LOGIN_SUFFIX, isAutomationLogin } from "../../src/index.js";

describe("an automation's login", () => {
    it.each([
        ["dependabot[bot]", true],
        ["Renovate[Bot]", true],
        ["alice", false],
        ["", false],
        // Not a suffix, so not a bot: reading this as one would exempt a
        // person from every rule a capability applies to people.
        ["app[bot]-migration", false],
        ["[bot]someone", false],
    ])("reads %s as %s", (login, automation) => {
        expect(isAutomationLogin(login)).toBe(automation);
    });

    it("is the suffix GitHub gives every App actor", () => {
        expect(AUTOMATION_LOGIN_SUFFIX).toBe("[bot]");
    });
});
