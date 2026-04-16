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
    .single();

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
    let body: { event_id?: string; user_id?: string; organization_id?: string; booking_id?: string } = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    const { event_id, user_id: bodyUserId, organization_id: bodyOrgId, booking_id: bodyBookingId } = body;

    if (!event_id) {
      return new Response(JSON.stringify({ error: "event_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
    const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let userId = bodyUserId;
    let gcalCalendarId = "primary";
    if (!userId && bodyBookingId && /^[0-9a-f-]{36}$/i.test(bodyBookingId)) {
      const { data: booking } = await supabase
        .from("bookings")
        .select("organization_id, organizations(owner_id), gcal_calendar_id")
        .eq("id", bodyBookingId)
        .maybeSingle();
      const ownerId = (booking as { organizations?: { owner_id?: string } } | null)?.organizations?.owner_id ?? null;
      userId = ownerId ?? null;
      const cid = ((booking as { gcal_calendar_id?: string | null } | null)?.gcal_calendar_id ?? "").trim();
      if (cid) gcalCalendarId = cid;
    }
    if (!userId && bodyOrgId) {
      const { data: org } = await supabase
        .from("organizations")
        .select("owner_id")
        .eq("id", bodyOrgId)
        .single();
      userId = org?.owner_id ?? null;
    }
    if (!userId) {
      return new Response(JSON.stringify({ error: "user_id or organization_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = await getValidAccessToken(supabase, userId, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
    if (!accessToken) {
      return new Response(JSON.stringify({ error: "Google Calendar not connected or token expired" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const deleteRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(gcalCalendarId)}/events/${encodeURIComponent(event_id)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!deleteRes.ok) {
      const errData = await deleteRes.text();
      console.error("GCal delete error:", deleteRes.status, errData);
      return new Response(
        JSON.stringify({
          error: "Failed to delete event from Google Calendar",
          details: errData,
        }),
        {
          status: deleteRes.status >= 500 ? 502 : 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("delete-gcal-event error:", err);
    return new Response(
      JSON.stringify({ error: "Failed to delete event", details: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
