import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Verify custom JWT (app auth) and extract user ID — same as admin-delete-user
async function verifyCustomJWT(token: string): Promise<{ sub: string; email: string } | null> {
  try {
    const secret = Deno.env.get("JWT_SECRET");
    if (!secret) return null;

    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const data = encoder.encode(`${parts[0]}.${parts[1]}`);
    const sig = Uint8Array.from(atob(parts[2].replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    const valid = await crypto.subtle.verify("HMAC", key, sig, data);
    if (!valid) return null;

    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;

    return { sub: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}

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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
    const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;

    // Resolve user: app uses custom JWT (sub = app_users.id), not Supabase Auth — try both
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
    let userId: string;

    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (user) {
      userId = user.id;
    } else {
      // Custom JWT (auth-custom): user lives in app_users, not auth.users
      const caller = await verifyCustomJWT(token);
      if (!caller) {
        return new Response(
          JSON.stringify({ error: "Unauthorized", details: userError?.message || "Invalid or expired token" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      userId = caller.sub;
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const accessToken = await getValidAccessToken(supabaseAdmin, userId, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
    if (!accessToken) {
      await supabaseAdmin.from("google_calendar_tokens").delete().eq("user_id", userId);
      await supabaseAdmin.from("gcal_disconnect_log").insert({ user_id: userId, disconnected_at: new Date().toISOString() });
      return new Response(JSON.stringify({ success: true, transferred: 0, message: "No token or already disconnected" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date();
    const rangeStart = new Date(now);
    rangeStart.setFullYear(rangeStart.getFullYear() - 1);
    const rangeEnd = new Date(now);
    rangeEnd.setFullYear(rangeEnd.getFullYear() + 2);
    const params = new URLSearchParams({
      timeMin: rangeStart.toISOString(),
      timeMax: rangeEnd.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "500",
    });

    const gcalRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const gcalData = await gcalRes.json();
    const items = gcalData.items || [];

    let transferred = 0;
    for (const e of items) {
      const priv = e.extendedProperties?.private || {};
      const organization_id = priv.organization_id;
      const location_id = priv.location_id;
      const service_id = priv.service_id;
      if (!organization_id || !location_id || !service_id) continue;

      const start = e.start?.dateTime || e.start?.date;
      const end = e.end?.dateTime || e.end?.date;
      if (!start || !end) continue;

      const { data: existing } = await supabaseAdmin
        .from("bookings")
        .select("id")
        .eq("gcal_event_id", e.id)
        .maybeSingle();
      if (existing) continue;

      const customer_name = (priv.customer_name as string) || e.summary || "Imported from Google Calendar";
      const customer_email = (priv.customer_email as string) || "imported@placeholder.local";
      const staff_id = priv.staff_id || null;

      const { error: insertErr } = await supabaseAdmin.from("bookings").insert({
        organization_id,
        location_id,
        service_id,
        staff_id,
        customer_name: customer_name.slice(0, 500),
        customer_email: customer_email.slice(0, 500),
        customer_phone: null,
        start_time: start,
        end_time: end,
        status: "confirmed",
        gcal_event_id: e.id,
        created_at: start,
        updated_at: start,
      });
      if (!insertErr) {
        transferred += 1;
        await supabaseAdmin.from("confirmed_booking_customers").upsert(
          {
            organization_id,
            customer_email: customer_email.slice(0, 500),
            customer_name: customer_name.slice(0, 500) || null,
            customer_phone: null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "organization_id,customer_email" }
        );
      }
    }

    await supabaseAdmin.from("gcal_disconnect_log").insert({
      user_id: userId,
      disconnected_at: now.toISOString(),
    });
    await supabaseAdmin.from("google_calendar_tokens").update({ disconnected_at: now.toISOString() }).eq("user_id", userId);

    return new Response(
      JSON.stringify({ success: true, transferred, message: `Disconnected. ${transferred} event(s) transferred to your calendar.` }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("disconnect-gcal error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
