import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
  const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/google-auth-callback`;

  // Step 1: Start OAuth — redirect user to Google
  if (action === "login") {
    const state = url.searchParams.get("state") || ""; // user_id
    const scopes = [
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/calendar.events",
    ].join(" ");

    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", GOOGLE_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", scopes);
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");
    authUrl.searchParams.set("state", state);

    return new Response(null, {
      status: 302,
      headers: { Location: authUrl.toString() },
    });
  }

  // Step 2: Handle Google callback with authorization code
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state"); // user_id

  if (!code || !state) {
    return new Response("Missing code or state", { status: 400 });
  }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });

    const tokens = await tokenRes.json();
    if (!tokenRes.ok) {
      console.error("Token exchange failed:", tokens);
      return new Response(`Token exchange failed: ${JSON.stringify(tokens)}`, { status: 400 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    // Delete any existing tokens for this user, then insert (table has no UNIQUE on user_id)
    await supabase.from("google_calendar_tokens").delete().eq("user_id", state);
    const { error } = await supabase.from("google_calendar_tokens").insert({
      user_id: state,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: expiresAt,
    });

    if (error) {
      console.error("DB insert error:", error);
      return new Response(`DB error: ${error.message}`, { status: 500 });
    }

    // Redirect back to the app settings page
    const appUrl = Deno.env.get("APP_URL") || "http://localhost:8080";
    return new Response(null, {
      status: 302,
      headers: { Location: `${appUrl}/dashboard/settings?gcal=connected` },
    });
  } catch (err) {
    console.error("Callback error:", err);
    return new Response(`Error: ${err.message}`, { status: 500 });
  }
});
