/** How GitHub spells an actor that is not a person: every App login ends `[bot]`. */

export const AUTOMATION_LOGIN_SUFFIX = "[bot]";

export function isAutomationLogin(login: string): boolean {
    return login.toLowerCase().endsWith(AUTOMATION_LOGIN_SUFFIX);
}
