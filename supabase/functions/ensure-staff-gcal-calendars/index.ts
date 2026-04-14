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
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { organization_id } = await req.json();
    if (!organization_id || typeof organization_id !== "string") {
      return new Response(JSON.stringify({ error: "organization_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
    const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: org, error: orgErr } = await supabase
      .from("organizations")
      .select("owner_id, gcal_use_staff_secondary_calendars")
      .eq("id", organization_id)
      .single();
    if (orgErr || !org?.owner_id) {
      return new Response(JSON.stringify({ error: "Organization not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!org.gcal_use_staff_secondary_calendars) {
      return new Response(
        JSON.stringify({ skipped: true, message: "Enable per-staff calendars in Settings first." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const accessToken = await getValidAccessToken(
      supabase,
      org.owner_id as string,
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
    );
    if (!accessToken) {
      return new Response(JSON.stringify({ error: "Connect Google Calendar (owner account) first." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: staffList, error: stErr } = await supabase
      .from("staff")
      .select("id, name, gcal_secondary_calendar_id, is_owner_placeholder")
      .eq("organization_id", organization_id)
      .eq("is_active", true);
    if (stErr) throw stErr;

    let created = 0;
    let skipped = 0;
    for (const s of staffList ?? []) {
      if ((s as { is_owner_placeholder?: boolean }).is_owner_placeholder) {
        skipped++;
        continue;
      }
      if ((s as { gcal_secondary_calendar_id?: string | null }).gcal_secondary_calendar_id) {
        skipped++;
        continue;
      }
      const name = String((s as { name?: string }).name || "Staff").trim();
      const summary = `Salonora — ${name}`;
      const res = await fetch("https://www.googleapis.com/calendar/v3/calendars", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ summary }),
      });
      const json = await res.json();
      if (!res.ok) {
        console.error("create calendar failed", json);
        continue;
      }
      const calId = json.id as string | undefined;
      if (!calId) continue;
      const { error: upErr } = await supabase
        .from("staff")
        .update({ gcal_secondary_calendar_id: calId })
        .eq("id", (s as { id: string }).id);
      if (!upErr) created++;
    }

    return new Response(JSON.stringify({ success: true, created, skipped }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
