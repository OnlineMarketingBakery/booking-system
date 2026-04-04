import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  provisionSalonOwnerFromPlugnpayContact,
  contactFromOrder,
  contactFromBillingDetails,
  contactEmail,
  type BillingContact,
} from "../_shared/plugnpay-provision-buyer.ts";

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

/** Normalize Plug&Pay webhook JSON to a single order-like object */
function unwrapOrderFromWebhookPayload(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const data = b.data;
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (d.order && typeof d.order === "object") return d.order as Record<string, unknown>;
    if (d.billing_details !== undefined || d.billing !== undefined || d.id !== undefined || d.uid !== undefined) {
      return d as Record<string, unknown>;
    }
  }
  if (b.order && typeof b.order === "object") return b.order as Record<string, unknown>;
  return b;
}

function resolveContactFromOrderShape(order: Record<string, unknown>): BillingContact | null {
  const fromNested = contactFromOrder(order as { billing?: { contact?: BillingContact } });
  if (fromNested && contactEmail(fromNested)) return fromNested;

  const bd = contactFromBillingDetails(order.billing_details);
  if (bd && contactEmail(bd)) return bd;

  const bill = order.billing;
  if (bill && typeof bill === "object") {
    const b = bill as Record<string, unknown>;
    const inner = b.contact;
    if (inner && typeof inner === "object") {
      const c = inner as BillingContact;
      if (contactEmail(c)) return c;
    }
    const flat = contactFromBillingDetails(bill);
    if (flat && contactEmail(flat)) return flat;
  }

  const customer = order.customer;
  if (customer && typeof customer === "object") {
    const c = customer as Record<string, unknown>;
    const flat = contactFromBillingDetails({
      email: c.email ?? c.email_address,
      first_name: c.first_name ?? c.firstname,
      last_name: c.last_name ?? c.lastname,
      name: c.name ?? c.full_name,
    });
    if (flat && contactEmail(flat)) return flat;
  }

  return null;
}

async function fetchOrderFromPlugnpayApi(
  orderId: string,
  apiKey: string
): Promise<Record<string, unknown> | null> {
  const url = new URL(`https://api.plugandpay.com/v2/orders/${encodeURIComponent(orderId)}`);
  url.searchParams.set("include", "items,payment,products,subscriptions,billing,shipping,taxes,discounts,utm");
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  if (!res.ok) return null;
  const json = await res.json();
  const order = json.data ?? json;
  if (!order || typeof order !== "object") return null;
  return order as Record<string, unknown>;
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

  const orderShape = unwrapOrderFromWebhookPayload(body);
  let contact: BillingContact | null = null;

  if (orderShape) {
    contact = resolveContactFromOrderShape(orderShape);
  }

  if (!contact || !contactEmail(contact)) {
    const plugKey = Deno.env.get("PLUGNPAY_API_KEY");
    const id = orderShape && (orderShape.id ?? orderShape.uid ?? orderShape.order_id);
    if (plugKey && id != null && String(id).length > 0) {
      const hydrated = await fetchOrderFromPlugnpayApi(String(id), plugKey);
      if (hydrated) {
        contact = resolveContactFromOrderShape(hydrated);
      }
    }
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  if (!contact || !contactEmail(contact)) {
    return new Response(
      JSON.stringify({
        ok: false,
        reason:
          "No customer email found on webhook. Ensure payload includes billing or set PLUGNPAY_API_KEY so the order can be loaded from the Plug&Pay API.",
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
