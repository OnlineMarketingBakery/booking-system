import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let body: { user_id?: string } = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    const { user_id } = body;
    if (!user_id) {
      return new Response(JSON.stringify({ error: "user_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Orgs where this user is the owner
    const { data: orgs, error: orgErr } = await supabase
      .from("organizations")
      .select("id")
      .eq("owner_id", user_id);
    if (orgErr || !orgs?.length) {
      return new Response(JSON.stringify({ synced: 0, message: "No organizations found" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const orgIds = orgs.map((o) => o.id);

    // Only sync bookings created after user's last GCal disconnect (avoid re-pushing events we transferred to DB)
    let disconnectedAt: string | null = null;
    const { data: lastDisconnect } = await supabase
      .from("gcal_disconnect_log")
      .select("disconnected_at")
      .eq("user_id", user_id)
      .order("disconnected_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastDisconnect?.disconnected_at) disconnectedAt = lastDisconnect.disconnected_at;

    // Existing bookings not yet synced to Google (no gcal_event_id), and created after last disconnect (if any).
    let bookings: { id: string; created_at: string }[] = [];
    let query = supabase
      .from("bookings")
      .select("id, created_at")
      .in("organization_id", orgIds)
      .neq("status", "cancelled")
      .is("gcal_event_id", null);
    const { data: withGcal, error: e1 } = await query;
    if (e1) {
      const { data: all, error: e2 } = await supabase
        .from("bookings")
        .select("id, created_at")
        .in("organization_id", orgIds)
        .neq("status", "cancelled");
      if (e2 || !all?.length) {
        return new Response(JSON.stringify({ synced: 0, message: "No bookings to sync" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      bookings = all as { id: string; created_at: string }[];
    } else {
      bookings = (withGcal ?? []) as { id: string; created_at: string }[];
    }
    if (disconnectedAt) {
      bookings = bookings.filter((b) => new Date(b.created_at) >= new Date(disconnectedAt!));
    }
    const bookingIds = bookings.map((b) => ({ id: b.id }));
    if (!bookingIds.length) {
      return new Response(JSON.stringify({ synced: 0, message: "No bookings to sync" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let synced = 0;
    for (const b of bookingIds) {
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/sync-booking-to-gcal`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({ booking_id: b.id }),
        });
        const data = await res.json();
        if (res.ok && (data.success || data.skipped)) synced += 1;
      } catch (e) {
        console.error("Backfill sync failed for booking", b.id, e);
      }
    }

    return new Response(JSON.stringify({ synced, total: bookingIds.length }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("backfill-bookings-to-gcal error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
