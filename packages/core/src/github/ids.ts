/**
 * `X-GitHub-Delivery` carries the opaque GUID used as the durable
 * deduplication key.
 */

declare const deliveryGuidBrand: unique symbol;

/** The GUID carried by `X-GitHub-Delivery`; the durable deduplication key. */
export type DeliveryGuid = string & { readonly [deliveryGuidBrand]: true };

const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function asDeliveryGuid(raw: string): DeliveryGuid | undefined {
    return typeof raw === "string" && GUID_PATTERN.test(raw) ? (raw as DeliveryGuid) : undefined;
}
