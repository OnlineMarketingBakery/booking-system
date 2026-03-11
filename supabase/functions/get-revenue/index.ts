import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Max-Age": "86400",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    const stripe = stripeKey ? new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" }) : null;

    // Authenticate the user via custom JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Authorization required");
    const token = authHeader.replace("Bearer ", "");
    
    // Decode custom JWT to get user ID
    let userId: string;
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      if (!payload.sub || (payload.exp && payload.exp * 1000 < Date.now())) {
        throw new Error("Invalid or expired token");
      }
      userId = payload.sub;
    } catch {
      throw new Error("Not authenticated");
    }

    // Get organization for the user
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: orgs } = await serviceClient
      .from("organizations")
      .select("id")
      .eq("owner_id", userId)
      .limit(1);

    if (!orgs || orgs.length === 0) {
      return new Response(JSON.stringify({ revenue: 0, currency: "eur", payments: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get all paid bookings with their service prices
    const { data: bookings } = await serviceClient
      .from("bookings")
      .select("id, status, stripe_session_id, stripe_payment_intent_id, services(price, currency)")
      .eq("organization_id", orgs[0].id)
      .in("status", ["paid", "completed"]);

    let totalRevenue = 0;
    for (const b of bookings || []) {
      totalRevenue += Number((b.services as any)?.price || 0);
    }

    // Query Stripe only when configured
    let stripeRevenue = 0;
    if (stripe) {
      try {
        const charges = await stripe.charges.list({ limit: 100 });
        for (const charge of charges.data) {
          if (charge.paid && !charge.refunded) {
            stripeRevenue += charge.amount;
          }
        }
      } catch (e) {
        console.error("Error fetching Stripe charges:", e);
      }
    }

    return new Response(
      JSON.stringify({
        db_revenue: totalRevenue,
        stripe_revenue_cents: stripeRevenue,
        stripe_revenue: stripeRevenue / 100,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[get-revenue] ERROR:", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
