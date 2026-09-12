/** GitHub's two webhook-delivery identifiers, branded so neither reaches the other's code. */

declare const deliveryGuidBrand: unique symbol;
declare const deliveryRecordIdBrand: unique symbol;

/** The GUID carried by `X-GitHub-Delivery`; the durable deduplication key. */
export type DeliveryGuid = string & { readonly [deliveryGuidBrand]: true };

/** The decimal REST delivery-record id; never convert it to a number. */
export type DeliveryRecordId = string & {
    readonly [deliveryRecordIdBrand]: true;
};

// Lowercase only: the store compares GUIDs as bytes, so a case variant would admit a second delivery.
const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function asDeliveryGuid(raw: string): DeliveryGuid | undefined {
    return typeof raw === "string" && GUID_PATTERN.test(raw) ? (raw as DeliveryGuid) : undefined;
}

export function asDeliveryRecordId(raw: string): DeliveryRecordId | undefined {
    return typeof raw === "string" && /^\d+$/.test(raw) ? (raw as DeliveryRecordId) : undefined;
}
