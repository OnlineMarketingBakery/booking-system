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
      .select(
        "*, services(name), staff(name, gcal_secondary_calendar_id, is_owner_placeholder), locations(name), organizations(owner_id, timezone, gcal_use_staff_secondary_calendars), gcal_event_id, gcal_calendar_id",
      )
      .eq("id", booking_id)
      .single();

    if (bErr || !booking) {
      return new Response(JSON.stringify({ error: "Booking not found" }), {
        status: 404,
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

    /** All sync uses the salon owner's Google account (one calendar / optional staff sub-calendars). */
    const calendarUserId = ownerId as string;

    const accessToken = await getValidAccessToken(supabase, calendarUserId, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
    if (!accessToken) {
      return new Response(JSON.stringify({ skipped: true, reason: "No Google Calendar connected" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const orgRow = booking.organizations as {
      timezone?: string | null;
      gcal_use_staff_secondary_calendars?: boolean | null;
    } | null;
    const orgTz = (orgRow?.timezone && String(orgRow.timezone).trim()) || "Europe/Amsterdam";

    /** Wall clock at the salon (for description — Google UI uses the viewer’s calendar timezone for the block). */
    function formatSalonLocal(iso: string, timeZone: string): string {
      try {
        return new Intl.DateTimeFormat("en-GB", {
          timeZone,
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        }).format(new Date(iso));
      } catch {
        return String(iso);
      }
    }

    const useStaffLayers = !!orgRow?.gcal_use_staff_secondary_calendars;
    const staffRow = booking.staff as {
      gcal_secondary_calendar_id?: string | null;
      is_owner_placeholder?: boolean | null;
    } | null;
    const secondaryCal =
      useStaffLayers && staffRow && !staffRow.is_owner_placeholder && staffRow.gcal_secondary_calendar_id
        ? String(staffRow.gcal_secondary_calendar_id).trim()
        : "";
    const storedCalId = ((booking as { gcal_calendar_id?: string | null }).gcal_calendar_id ?? "").trim();
    const calendarIdForApi = storedCalId || (secondaryCal || "primary");

    const startIso = String(booking.start_time);
    const endIso = String(booking.end_time);
    const salonWhen = `Salon time (${orgTz}): ${formatSalonLocal(startIso, orgTz)} – ${formatSalonLocal(endIso, orgTz)}`;

    const gcalEventBody = {
      summary: `${booking.customer_name} — ${(booking.services as any)?.name || "Appointment"}`,
      description: `${salonWhen}\n\nStaff: ${(booking.staff as any)?.name || "—"}\nLocation: ${(booking.locations as any)?.name || "—"}\nEmail: ${booking.customer_email}\nPhone: ${booking.customer_phone || "N/A"}\nStatus: ${booking.status}`,
      // RFC3339 instant from DB; timeZone is optional when offset is present but helps recurrence tools.
      start: { dateTime: startIso, timeZone: orgTz },
      end: { dateTime: endIso, timeZone: orgTz },
      extendedProperties: {
        private: {
          booking_id: booking_id,
          location_id: booking.location_id,
          organization_id: booking.organization_id,
          service_id: booking.service_id,
          customer_name: booking.customer_name,
          customer_email: booking.customer_email,
          ...(booking.staff_id && { staff_id: booking.staff_id }),
        },
      },
    };

    const calPath = encodeURIComponent(calendarIdForApi);
    const existingGcalId = (booking as any).gcal_event_id as string | null;
    if (existingGcalId) {
      const patchRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${calPath}/events/${encodeURIComponent(existingGcalId)}?sendUpdates=all`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(gcalEventBody),
        },
      );
      const patchData = await patchRes.json();
      if (!patchRes.ok) {
        console.error("GCal patch event error:", patchData);
        return new Response(JSON.stringify({ error: "Failed to update Google Calendar event", details: patchData }), {
          status: patchRes.status >= 500 ? 502 : 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ success: true, event_id: existingGcalId, updated: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Only create new GCal events for bookings created after user's last GCal disconnect
    const { data: lastDisconnect } = await supabase
      .from("gcal_disconnect_log")
      .select("disconnected_at")
      .eq("user_id", calendarUserId)
      .order("disconnected_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const disconnectedAt = lastDisconnect?.disconnected_at ? new Date(lastDisconnect.disconnected_at) : null;
    const bookingCreatedAt = new Date(booking.created_at);
    if (disconnectedAt && bookingCreatedAt < disconnectedAt) {
      return new Response(JSON.stringify({ skipped: true, reason: "Booking predates last disconnect (already in GCal)" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const gcalRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calPath}/events?sendUpdates=all`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(gcalEventBody),
    });

    const gcalData = await gcalRes.json();
    if (!gcalRes.ok) {
      console.error("GCal create event error:", gcalData);
      return new Response(JSON.stringify({ error: "Failed to create GCal event", details: gcalData }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: updateErr } = await supabase
      .from("bookings")
      .update({ gcal_event_id: gcalData.id, gcal_calendar_id: calendarIdForApi === "primary" ? null : calendarIdForApi })
      .eq("id", booking_id);
    if (updateErr) {
      // Column may not exist yet (migration not run)
    }

    return new Response(JSON.stringify({ success: true, event_id: gcalData.id }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("sync-booking-to-gcal error:", err);
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
