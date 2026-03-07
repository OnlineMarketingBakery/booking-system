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
    const { user_id, time_min, time_max } = await req.json();

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
    const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const accessToken = await getValidAccessToken(supabase, user_id, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
    if (!accessToken) {
      return new Response(JSON.stringify({ events: [], connected: false }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const params = new URLSearchParams({
      timeMin: time_min,
      timeMax: time_max,
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
      console.error("GCal fetch error:", gcalData);
      return new Response(JSON.stringify({ error: "Failed to fetch GCal events" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const events = (gcalData.items || []).map((e: any) => ({
      id: e.id,
      summary: e.summary || "(No title)",
      start: e.start?.dateTime || e.start?.date,
      end: e.end?.dateTime || e.end?.date,
      description: e.description || "",
    }));

    return new Response(JSON.stringify({ events, connected: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("fetch-gcal-events error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
