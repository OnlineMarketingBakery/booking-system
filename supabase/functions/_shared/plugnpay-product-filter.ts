/**
 * When PLUGNPAY_PROVISION_PRODUCT_IDS is set (comma-separated Plug&Pay product ids),
 * only those orders/line items trigger Salonora provisioning.
 * When unset or empty, all products are allowed (backward compatible).
 */

export function parseAllowedPlugnpayProductIds(): Set<string> | null {
  const raw = Deno.env.get("PLUGNPAY_PROVISION_PRODUCT_IDS")?.trim();
  if (!raw) return null;
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((id) => String(id));
  return ids.length ? new Set(ids) : null;
}

/** True if filter is off, or if any order line item matches an allowed product id */
export function orderHasAllowedPlugnpayProduct(order: unknown, allowed: Set<string> | null): boolean {
  if (!allowed) return true;
  if (!order || typeof order !== "object") return false;
  const items = (order as Record<string, unknown>).items;
  if (!Array.isArray(items)) return false;
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const nested = row.product;
    const pid =
      row.product_id ??
      (nested && typeof nested === "object" ? (nested as Record<string, unknown>).id : undefined);
    if (pid === undefined || pid === null) continue;
    if (allowed.has(String(pid))) return true;
  }
  return false;
}
