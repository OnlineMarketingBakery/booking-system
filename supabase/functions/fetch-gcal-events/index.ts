import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function getValidAccessToken(supabase: any, userId: string, clientId: string, clientSecret: string) {
  const { data: tokenRow, error } = await supabase
    .from("google_calendar_tokens")
    .select("*")
    .eq("user_id", userId)
    .is("disconnected_at", null)
    .maybeSingle();

  if (error || !tokenRow) return null;

  if (new Date(tokenRow.token_expires_at) > new Date(Date.now() + 60000)) {
    return tokenRow.access_token;
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokenRow.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  const tokens = await res.json();
  if (!res.ok) return null;

  await supabase
    .from("google_calendar_tokens")
    .update({
      access_token: tokens.access_token,
      token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    })
    .eq("user_id", userId);

  return tokens.access_token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let body: { user_id?: string; organization_id?: string; time_min?: string; time_max?: string } = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    const { user_id: bodyUserId, organization_id, time_min, time_max } = body;
    if (!bodyUserId && !organization_id) {
      return new Response(JSON.stringify({ error: "user_id or organization_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
    const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Google `primary` + sync-booking-to-gcal use the **organization owner's** tokens. Staff may
    // pass their own user_id; we must still use the owner's account for list/get/reconcile.
    let googleUserId: string | null = null;
    if (organization_id) {
      const { data: orgRow } = await supabase
        .from("organizations")
        .select("owner_id")
        .eq("id", organization_id)
        .single();
      googleUserId = orgRow?.owner_id ?? null;
    }
    if (!googleUserId) {
      googleUserId = bodyUserId ?? null;
    }
    if (!googleUserId) {
      return new Response(JSON.stringify({ events: [], connected: false }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = await getValidAccessToken(supabase, googleUserId, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
    if (!accessToken) {
      return new Response(JSON.stringify({ events: [], connected: false }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay() + 1);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);
    const params = new URLSearchParams({
      timeMin: time_min || weekStart.toISOString(),
      timeMax: time_max || weekEnd.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250",
    });

    const gcalRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    const gcalData = await gcalRes.json();
    if (!gcalRes.ok) {
      const message = gcalData?.error?.message || gcalData?.error_description || JSON.stringify(gcalData);
      console.error("GCal fetch error:", gcalRes.status, message, gcalData);
      return new Response(
        JSON.stringify({
          error: "Failed to fetch GCal events",
          details: message,
          code: gcalData?.error?.code || gcalRes.status,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const events = (gcalData.items || []).map((e: any) => {
      const priv = e.extendedProperties?.private || {};
      return {
        id: e.id,
        booking_id: priv.booking_id || null,
        summary: e.summary || "(No title)",
        start: e.start?.dateTime || e.start?.date,
        end: e.end?.dateTime || e.end?.date,
        description: e.description || "",
        location_id: priv.location_id || null,
        organization_id: priv.organization_id || null,
        service_id: priv.service_id || null,
        staff_id: priv.staff_id || null,
      };
    });

    // Same window as list(): only bookings starting in this range are checked. For each, GET the
    // event by id — 404/410 means it was removed in Google → cancel Salonora row (old code wrongly
    // inferred deletion from "not in list()" and deleted unrelated weeks).
    const tmMin = params.get("timeMin")!;
    const tmMax = params.get("timeMax")!;
    let reconcileOrgIds: string[] = [];
    if (organization_id) {
      reconcileOrgIds = [organization_id];
    } else {
      const { data: orgsForReconcile } = await supabase
        .from("organizations")
        .select("id")
        .eq("owner_id", googleUserId);
      reconcileOrgIds = (orgsForReconcile || []).map((o: { id: string }) => o.id);
    }
    const gcal_reconcile = { checked: 0, cancelled: 0 };
    const MAX_RECONCILE = 80;
    if (reconcileOrgIds.length > 0) {
      const { data: syncRows } = await supabase
        .from("bookings")
        .select("id, gcal_event_id")
        .in("organization_id", reconcileOrgIds)
        .not("gcal_event_id", "is", null)
        .in("status", ["pending", "confirmed", "paid"])
        .lt("start_time", tmMax)
        .gt("end_time", tmMin)
        .limit(MAX_RECONCILE);

      for (const b of syncRows || []) {
        const evId = b.gcal_event_id as string;
        if (!evId) continue;
        gcal_reconcile.checked++;
        const evUrl =
          `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(evId)}`;
        const evRes = await fetch(evUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        let shouldCancel = evRes.status === 404 || evRes.status === 410;
        if (evRes.ok) {
          try {
            const ej = (await evRes.json()) as { status?: string };
            if (ej?.status === "cancelled") shouldCancel = true;
          } catch {
            /* ignore parse errors */
          }
        }
        if (shouldCancel) {
          const { error: upErr } = await supabase
            .from("bookings")
            .update({ status: "cancelled", gcal_event_id: null })
            .eq("id", b.id as string)
            .in("status", ["pending", "confirmed", "paid"]);
          if (!upErr) gcal_reconcile.cancelled++;
        }
      }
    }

    return new Response(JSON.stringify({ events, connected: true, gcal_reconcile }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("fetch-gcal-events error:", err);
    return new Response(
      JSON.stringify({ error: "Failed to fetch GCal events", details: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
