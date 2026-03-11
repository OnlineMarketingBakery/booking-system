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
    const token = (body.token ?? new URL(req.url).searchParams.get("token")) as string | null;
    if (!token || typeof token !== "string") {
      return new Response(
        JSON.stringify({ error: "Token is required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const { data: pending, error: pendingErr } = await supabase
      .from("pending_booking_confirmations")
      .select("id, payload, save_my_info, used_at, expires_at")
      .eq("token", token)
      .single();

    if (pendingErr || !pending) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired confirmation link" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404 }
      );
    }
    if ((pending as { used_at: string | null }).used_at) {
      return new Response(
        JSON.stringify({ error: "This confirmation link has already been used" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }
    if (new Date((pending as { expires_at: string }).expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ error: "This confirmation link has expired" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const payload = (pending as { payload: Record<string, unknown> }).payload;
    const save_my_info = !!(pending as { save_my_info: boolean }).save_my_info;
    const checkoutBody = { ...payload };
    delete (checkoutBody as Record<string, unknown>).save_my_info;

    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/create-booking-checkout`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
      body: JSON.stringify(checkoutBody),
    });
    const data = await res.json();

    if (!res.ok) {
      return new Response(JSON.stringify(data), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: res.status });
    }

    const orgId = payload.organization_id as string;
    const email = (payload.customer_email as string).trim().toLowerCase();

    await supabase.from("confirmed_booking_customers").upsert(
      {
        organization_id: orgId,
        customer_email: email,
        customer_name: save_my_info ? (payload.customer_name as string)?.trim() ?? null : null,
        customer_phone: save_my_info ? (payload.customer_phone as string)?.trim() || null : null,
        has_confirmed_once: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,customer_email" }
    );

    await supabase
      .from("pending_booking_confirmations")
      .update({ used_at: new Date().toISOString() })
      .eq("token", token);

    return new Response(JSON.stringify(data), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[confirm-booking-by-token] ERROR:", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
