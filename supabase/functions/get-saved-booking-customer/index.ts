import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const body = await req.json().catch(() => ({}));
    const organization_id = body.organization_id as string | undefined;
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

    if (!organization_id || !email || email.length < 3) {
      return new Response(
        JSON.stringify({ customer_name: null, customer_phone: null }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    const { data, error } = await supabase
      .from("confirmed_booking_customers")
      .select("customer_name, customer_phone")
      .eq("organization_id", organization_id)
      .eq("customer_email", email)
      .maybeSingle();

    if (error) {
      console.error("[get-saved-booking-customer]", error);
      return new Response(
        JSON.stringify({ customer_name: null, customer_phone: null }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    return new Response(
      JSON.stringify({
        customer_name: data?.customer_name ?? null,
        customer_phone: data?.customer_phone ?? null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (e) {
    console.error("[get-saved-booking-customer] ERROR:", e);
    return new Response(
      JSON.stringify({ customer_name: null, customer_phone: null }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  }
});
