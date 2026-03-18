import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const body = await req.json().catch(() => ({}));
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token || !UUID_RE.test(token)) {
      return new Response(
        JSON.stringify({ error: "Valid token is required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
      );
    }

    const now = new Date().toISOString();
    const { data: updated, error } = await supabase
      .from("pending_booking_confirmations")
      .update({ released_at: now })
      .eq("token", token)
      .is("used_at", null)
      .is("released_at", null)
      .gt("expires_at", now)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("[cancel-pending-booking-hold]", error);
      return new Response(
        JSON.stringify({ error: "Could not release this hold" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
      );
    }

    if (!updated) {
      return new Response(
        JSON.stringify({
          ok: false,
          message:
            "This reservation hold is no longer active (already confirmed, cancelled, or expired).",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    return new Response(
      JSON.stringify({ ok: true, message: "The time slot has been released." }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cancel-pending-booking-hold] ERROR:", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
    );
  }
});
