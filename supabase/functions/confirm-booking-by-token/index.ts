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
    const checkoutBody = {
      ...payload,
      pending_confirmation_token: token,
    };
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
    const nameVal = typeof payload.customer_name === "string"
      ? payload.customer_name.trim()
      : (typeof (payload as Record<string, unknown>).customerName === "string"
        ? ((payload as Record<string, unknown>).customerName as string).trim()
        : "");
    const phoneVal = typeof payload.customer_phone === "string"
      ? payload.customer_phone.trim()
      : (typeof (payload as Record<string, unknown>).customerPhone === "string"
        ? ((payload as Record<string, unknown>).customerPhone as string).trim()
        : "");

    const upsertRow: Record<string, unknown> = {
      organization_id: orgId,
      customer_email: email,
      has_confirmed_once: true,
      updated_at: new Date().toISOString(),
    };
    // Always persist name and phone from this booking (so we have contact info). Only add when we have a value so we never overwrite with null.
    if (nameVal) upsertRow.customer_name = nameVal;
    if (phoneVal) upsertRow.customer_phone = phoneVal;

    await supabase.from("confirmed_booking_customers").upsert(
      upsertRow as { organization_id: string; customer_email: string; customer_name?: string | null; customer_phone?: string | null; has_confirmed_once: boolean; updated_at: string },
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
