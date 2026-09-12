/**
 * GitHub's permission strings as a shape — `scope:level`, never which ones we ask for.
 * A validated template type, so the platform needs no edit when GitHub adds a scope.
 */

export type PermissionGrant = `${string}:${"read" | "write"}`;

const PERMISSION_PATTERN = /^[a-z][a-z_]*:(read|write)$/;

/** Runtime check for a value that arrives as an ordinary string. */
export function isPermissionGrant(value: string): value is PermissionGrant {
    return PERMISSION_PATTERN.test(value);
}

const READ_SUFFIX = ":read";

/** GitHub's levels are a ladder per resource: `issues:write` covers `issues:read`, never the reverse. */
function widerGrantFor(required: PermissionGrant): PermissionGrant | null {
    return required.endsWith(READ_SUFFIX)
        ? `${required.slice(0, -READ_SUFFIX.length)}:write`
        : null;
}

/** The grants an operation needs and the installation lacks — named, not a boolean (D77). */
export function missingPermissions(
    required: readonly PermissionGrant[],
    granted: readonly PermissionGrant[],
): readonly PermissionGrant[] {
    const held: ReadonlySet<string> = new Set(granted);
    return required.filter((r) => {
        const wider = widerGrantFor(r);
        return !held.has(r) && (wider === null || !held.has(wider));
    });
}
