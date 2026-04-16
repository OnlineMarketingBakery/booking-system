import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  provisionSalonOwnerFromPlugnpayContact,
  contactFromSubscriptionRecord,
  contactEmail,
} from "../_shared/plugnpay-provision-buyer.ts";
import {
  parseAllowedPlugnpayProductIds,
  subscriptionHasAllowedPlugnpayProduct,
  subscriptionMissingProductRef,
} from "../_shared/plugnpay-product-filter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-salonora-webhook-secret",
};

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

const asRec = (x: unknown): Record<string, unknown> | null =>
  x && typeof x === "object" ? (x as Record<string, unknown>) : null;

/**
 * Extract subscription object from Plug&Pay webhook JSON.
 * Only v2/subscriptions is used for hydration — never orders.
 */
function unwrapSubscriptionFromWebhookPayload(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;

  const top = asRec(b.subscription);
  if (top) return top;

  const data = asRec(b.data);
  if (data) {
    const nested = asRec(data.subscription);
    if (nested) return nested;
    const rt = String(b.resource_type ?? data.resource_type ?? "").toLowerCase();
    if (rt === "subscription") return data;
    const looksLikeOrder =
      (data.order && typeof data.order === "object") ||
      (Array.isArray(data.items) && data.items.length > 0);
    if (!looksLikeOrder && asRec(data.billing) && (data.product_id != null || asRec(data.product))) {
      return data;
    }
  }

  const root = asRec(b);
  if (root && !data && asRec(root.billing) && (root.product_id != null || asRec(root.product))) {
    const looksLikeOrder =
      (Array.isArray(root.items) && root.items.length > 0) || (root.order && typeof root.order === "object");
    if (!looksLikeOrder) return root;
  }

  return null;
}

async function fetchSubscriptionFromPlugnpayApi(
  subscriptionId: string,
  apiKey: string
): Promise<Record<string, unknown> | null> {
  const url = new URL(`https://api.plugandpay.com/v2/subscriptions/${encodeURIComponent(subscriptionId)}`);
  url.searchParams.set(
    "include",
    "billing,product,pricing,product_images,tags,trial,utm"
  );
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  if (!res.ok) return null;
  const json = await res.json();
  const sub = json.data ?? json;
  if (!sub || typeof sub !== "object") return null;
  return sub as Record<string, unknown>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const webhookSecret = Deno.env.get("PLUGNPAY_WEBHOOK_SECRET");
  const parsedUrl = new URL(req.url);
  const qSecret = parsedUrl.searchParams.get("secret") ?? "";
  const hdrSecret = req.headers.get("X-Salonora-Webhook-Secret") ?? "";
  const authorized = Boolean(
    webhookSecret &&
      ((qSecret && timingSafeEqual(webhookSecret, qSecret)) ||
        (hdrSecret && timingSafeEqual(webhookSecret, hdrSecret)))
  );

  if (!authorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "Invalid JSON body" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const allowedProducts = parseAllowedPlugnpayProductIds();
  const plugKey = Deno.env.get("PLUGNPAY_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  let subRecord = unwrapSubscriptionFromWebhookPayload(body);
  if (!subRecord) {
    return new Response(
      JSON.stringify({
        ok: false,
        reason: "not_subscription_payload",
        detail:
          "Could not parse a subscription from the body. Use subscription webhooks / payloads with billing + product (or data.subscription / resource_type subscription). The orders API is not used.",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  let sub: Record<string, unknown> = subRecord;
  const subIdEarly = sub.id ?? sub.uid ?? sub.subscription_id;

  if (plugKey && subIdEarly != null && String(subIdEarly).length > 0) {
    if (allowedProducts && subscriptionMissingProductRef(sub)) {
      const hydrated = await fetchSubscriptionFromPlugnpayApi(String(subIdEarly), plugKey);
      if (hydrated) sub = hydrated;
    }
  }

  if (allowedProducts && !subscriptionHasAllowedPlugnpayProduct(sub, allowedProducts)) {
    return new Response(
      JSON.stringify({
        ok: true,
        skipped: true,
        reason: "product_not_in_allowlist",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  let contact = contactFromSubscriptionRecord(sub);
  if (!contact || !contactEmail(contact)) {
    if (plugKey && subIdEarly != null && String(subIdEarly).length > 0) {
      const hydrated = await fetchSubscriptionFromPlugnpayApi(String(subIdEarly), plugKey);
      if (hydrated) {
        sub = hydrated;
        contact = contactFromSubscriptionRecord(hydrated);
      }
    }
  }

  if (!contact || !contactEmail(contact)) {
    return new Response(
      JSON.stringify({
        ok: false,
        reason:
          "No customer email on subscription payload. Include billing or set PLUGNPAY_API_KEY to load v2/subscriptions/{id}.",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const result = await provisionSalonOwnerFromPlugnpayContact(admin, contact);
  return new Response(JSON.stringify({ ok: true, result }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
