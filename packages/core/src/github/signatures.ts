/** How GitHub signs a webhook delivery: HMAC-SHA256 of the raw body, hex, `sha256=` prefixed. */

import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "x-hub-signature-256";

export function signBody(secret: string, body: Uint8Array | string): string {
    return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/**
 * Verify a delivery's signature header against the raw body. Never throws.
 * The length guard is required: `timingSafeEqual` throws on unequal lengths.
 */
export function verifyBody(
    secret: string,
    body: Uint8Array | string,
    header: string | undefined,
): boolean {
    if (header === undefined) return false;
    const expected = Buffer.from(signBody(secret, body));
    const presented = Buffer.from(header);
    return presented.length === expected.length && timingSafeEqual(presented, expected);
}
