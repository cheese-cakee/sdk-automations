/**
 * GitHub's permission strings, as a shape rather than a list.
 *
 * The FORM is a GitHub fact — `scope:level` — so it belongs here. The
 * ratified permission CEILING is a project decision and does not: that stays
 * with the register and the App manifest. This file says what a permission
 * looks like, never which ones we ask for.
 *
 * A validated template type rather than a closed union, so the platform
 * needs no edit when GitHub adds a scope.
 */

export type PermissionGrant = `${string}:${"read" | "write"}`;

const PERMISSION_PATTERN = /^[a-z][a-z_]*:(read|write)$/;

/** Runtime check for a value that arrives as an ordinary string. */
export function isPermissionGrant(value: string): value is PermissionGrant {
    return PERMISSION_PATTERN.test(value);
}

/**
 * Does an installation's grant cover everything an operation needs?
 *
 * Returns the MISSING grants, not a boolean. An operator message that names
 * the absent permission is the difference between a fix and an investigation
 * (D77).
 */
export function missingPermissions(
    required: readonly PermissionGrant[],
    granted: readonly PermissionGrant[],
): readonly PermissionGrant[] {
    const held = new Set(granted);
    return required.filter((r) => !held.has(r));
}
