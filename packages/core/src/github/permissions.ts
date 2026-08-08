/**
 * GitHub's permission strings, as a shape rather than a list.
 *
 * The FORM is a GitHub fact — `scope:level` — so it belongs here. The
 * ratified permission CEILING is a project decision and does not: that stays
 * with the register and the App manifest. This file describes what a
 * permission looks like, never which ones we ask for.
 *
 * Kept as a validated template type rather than a closed union so the
 * platform needs no edit when GitHub adds a scope.
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
 * Returns the MISSING grants rather than a boolean, because a boolean is
 * exactly what the safety engine used to be handed and it could never say
 * which permission was absent — the difference between an operator message
 * that helps and one that starts an investigation.
 */
export function missingPermissions(
    required: readonly PermissionGrant[],
    granted: readonly PermissionGrant[],
): readonly PermissionGrant[] {
    const held = new Set(granted);
    return required.filter((r) => !held.has(r));
}
