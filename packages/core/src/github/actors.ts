/**
 * How GitHub spells an actor that is not a person.
 *
 * Every GitHub App acts under a login with the `[bot]` suffix, which is the
 * whole of what "is this an automation?" needs — no call, no credential, no
 * membership read. Observed, so it lives here with the rest of what we know
 * about GitHub rather than in whichever layer asked first.
 *
 * It is here rather than in the adapter because two layers answer with it: the
 * adapter's resolver source on the live path, and the shell's credential-free
 * one. The fact told twice would be two facts.
 */

/** The suffix GitHub gives every App actor's login. */
export const AUTOMATION_LOGIN_SUFFIX = "[bot]";

/**
 * Is this login an automation's?
 *
 * The suffix must END the login: `app[bot]-migration` is a person who chose an
 * awkward name, and reading it as a bot would exempt them from every rule a
 * capability applies to people.
 */
export function isAutomationLogin(login: string): boolean {
    return login.toLowerCase().endsWith(AUTOMATION_LOGIN_SUFFIX);
}
