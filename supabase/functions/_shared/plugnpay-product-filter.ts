/**
 * When PLUGNPAY_PROVISION_PRODUCT_IDS is set (comma-separated Plug&Pay product ids),
 * only matching subscriptions (`product_id` / `product.id`) trigger Salonora provisioning.
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

/** True if filter is off, or subscription `product_id` / `product.id` is in the allowlist */
export function subscriptionHasAllowedPlugnpayProduct(
  sub: unknown,
  allowed: Set<string> | null
): boolean {
  if (!allowed) return true;
  if (!sub || typeof sub !== "object") return false;
  const r = sub as Record<string, unknown>;
  const nested = r.product;
  const pid =
    r.product_id ??
    (nested && typeof nested === "object" ? (nested as Record<string, unknown>).id : undefined);
  if (pid === undefined || pid === null) return false;
  return allowed.has(String(pid));
}

/** True if `product_id` / `product.id` is missing (hydrate from API before allowlist check). */
export function subscriptionMissingProductRef(sub: unknown): boolean {
  if (!sub || typeof sub !== "object") return true;
  const r = sub as Record<string, unknown>;
  const nested = r.product;
  const pid =
    r.product_id ??
    (nested && typeof nested === "object" ? (nested as Record<string, unknown>).id : undefined);
  return pid === undefined || pid === null;
}
