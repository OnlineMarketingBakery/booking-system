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

  // If token is still valid, return it
  if (new Date(tokenRow.token_expires_at) > new Date(Date.now() + 60000)) {
    return tokenRow.access_token;
  }

  // Refresh the token
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
  if (!res.ok) {
    console.error("Token refresh failed:", tokens);
    return null;
  }

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
    const { booking_id } = await req.json();

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
    const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get booking with org info (include gcal_event_id to skip already-synced)
    const { data: booking, error: bErr } = await supabase
      .from("bookings")
      .select("*, services(name), staff(name), locations(name), organizations(owner_id), gcal_event_id")
      .eq("id", booking_id)
      .single();

    if (bErr || !booking) {
      return new Response(JSON.stringify({ error: "Booking not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Already synced to Google Calendar (e.g. from a previous connection or backfill)
    if ((booking as any).gcal_event_id) {
      return new Response(JSON.stringify({ success: true, event_id: (booking as any).gcal_event_id, skipped: true, reason: "Already synced" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ownerId = (booking.organizations as any)?.owner_id;
    if (!ownerId) {
      return new Response(JSON.stringify({ error: "No org owner" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = await getValidAccessToken(supabase, ownerId, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
    if (!accessToken) {
      return new Response(JSON.stringify({ skipped: true, reason: "No Google Calendar connected" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create Google Calendar event
    const event = {
      summary: `${booking.customer_name} — ${(booking.services as any)?.name || "Appointment"}`,
      description: `Staff: ${(booking.staff as any)?.name}\nLocation: ${(booking.locations as any)?.name}\nEmail: ${booking.customer_email}\nPhone: ${booking.customer_phone || "N/A"}\nStatus: ${booking.status}`,
      start: { dateTime: booking.start_time, timeZone: "UTC" },
      end: { dateTime: booking.end_time, timeZone: "UTC" },
    };

    const gcalRes = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    });

    const gcalData = await gcalRes.json();
    if (!gcalRes.ok) {
      console.error("GCal create event error:", gcalData);
      return new Response(JSON.stringify({ error: "Failed to create GCal event", details: gcalData }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Store so we don't create duplicates on reconnect or double-sync (ignore if column missing)
    const { error: updateErr } = await supabase.from("bookings").update({ gcal_event_id: gcalData.id }).eq("id", booking_id);
    if (updateErr) {
      // Column may not exist yet (migration not run)
    }

    return new Response(JSON.stringify({ success: true, event_id: gcalData.id }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("sync-booking-to-gcal error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
