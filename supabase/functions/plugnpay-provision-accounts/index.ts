import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  provisionSalonOwnerFromPlugnpayContact,
  contactFromOrder,
  contactEmail,
  type BillingContact,
} from "../_shared/plugnpay-provision-buyer.ts";
import {
  orderHasAllowedPlugnpayProduct,
  parseAllowedPlugnpayProductIds,
} from "../_shared/plugnpay-product-filter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-plugnpay-cron-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function verifyCustomJWT(token: string): Promise<{ sub: string; email: string } | null> {
  try {
    const secret = Deno.env.get("JWT_SECRET");
    if (!secret) return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw", encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
    );
    const data = encoder.encode(`${parts[0]}.${parts[1]}`);
    const sig = Uint8Array.from(atob(parts[2].replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify("HMAC", key, sig, data);
    if (!valid) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return { sub: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const cronSecret = Deno.env.get("PLUGNPAY_CRON_SECRET");
    const cronHeader = req.headers.get("X-Plugnpay-Cron-Secret") ?? "";
    const okCron = Boolean(
      cronSecret && cronHeader && timingSafeEqual(cronSecret, cronHeader)
    );

    if (!okCron) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const token = authHeader.replace("Bearer ", "");
      const caller = await verifyCustomJWT(token);
      if (!caller) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: isSuper } = await admin.rpc("has_role", { _user_id: caller.sub, _role: "super_admin" });
      if (!isSuper) {
        return new Response(JSON.stringify({ error: "Forbidden: super_admin role required" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const plugKey = Deno.env.get("PLUGNPAY_API_KEY");
    if (!plugKey) {
      return new Response(JSON.stringify({ error: "PLUGNPAY_API_KEY is not configured for this project" }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let page = 1;
    const allOrders: { billing?: { contact?: BillingContact } }[] = [];
    let lastPage = 1;

    do {
      const url = new URL("https://api.plugandpay.com/v2/orders");
      url.searchParams.set("limit", "25");
      url.searchParams.set("page", String(page));
      url.searchParams.set("include", "items,payment,products,subscriptions,billing,shipping,taxes,discounts,utm");

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${plugKey}`, Accept: "application/json" },
      });
      if (!res.ok) {
        const text = await res.text();
        return new Response(JSON.stringify({ error: `Plug&Pay API error ${res.status}`, detail: text.slice(0, 500) }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const result = await res.json();
      const batch = result.data ?? [];
      allOrders.push(...batch);
      lastPage = result.meta?.last_page ?? page;
      page += 1;
    } while (page <= lastPage);

    const allowedProducts = parseAllowedPlugnpayProductIds();
    const emailToContact = new Map<string, BillingContact>();
    for (const order of allOrders) {
      if (!orderHasAllowedPlugnpayProduct(order, allowedProducts)) continue;
      const c = contactFromOrder(order);
      if (!c) continue;
      const em = contactEmail(c);
      if (!em) continue;
      if (!emailToContact.has(em)) emailToContact.set(em, c);
    }

    const created: { email: string; user_id: string }[] = [];
    const skippedExisting: string[] = [];
    const errors: string[] = [];

    for (const [emailNorm, contact] of emailToContact) {
      const result = await provisionSalonOwnerFromPlugnpayContact(admin, contact);
      if (result.outcome === "skipped") {
        skippedExisting.push(emailNorm);
        continue;
      }
      if (result.outcome === "failed") {
        errors.push(`${emailNorm}: ${result.reason}`);
        continue;
      }
      if (result.outcome === "created_no_email") {
        created.push({ email: result.email, user_id: result.user_id });
        errors.push(`${emailNorm} (email): ${result.email_error}`);
        continue;
      }
      created.push({ email: result.email, user_id: result.user_id });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        orders_scanned: allOrders.length,
        billing_emails_unique: emailToContact.size,
        created,
        skipped_existing_count: skippedExisting.length,
        errors,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
