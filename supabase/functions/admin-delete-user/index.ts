import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { deleteOrganizationScopedData } from "../_shared/deleteOrganizationScopedData.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Max-Age": "86400",
};

// Verify custom JWT and extract user ID
async function verifyCustomJWT(token: string): Promise<{ sub: string; email: string } | null> {
  try {
    const secret = Deno.env.get("JWT_SECRET");
    if (!secret) return null;

    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw", encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
    );

    const data = encoder.encode(`${parts[0]}.${parts[1]}`);
    const sig = Uint8Array.from(atob(parts[2].replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify("HMAC", key, sig, data);
    if (!valid) return null;

    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;

    return { sub: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const caller = await verifyCustomJWT(token);
    if (!caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Check super_admin role
    const { data: hasRole } = await adminClient.rpc("has_role", { _user_id: caller.sub, _role: "super_admin" });
    if (!hasRole) {
      return new Response(JSON.stringify({ error: "Forbidden: super_admin required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { user_id } = await req.json();
    if (!user_id) {
      return new Response(JSON.stringify({ error: "user_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Organizations no longer FK-cascade from app_users (custom auth). Remove tenant data first.
    const { data: ownedOrgs, error: orgListErr } = await adminClient
      .from("organizations")
      .select("id")
      .eq("owner_id", user_id);
    if (orgListErr) {
      return new Response(JSON.stringify({ error: orgListErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    for (const row of ownedOrgs ?? []) {
      const orgId = row.id as string;
      await deleteOrganizationScopedData(adminClient, orgId);
      const { error: delOrgErr } = await adminClient.from("organizations").delete().eq("id", orgId);
      if (delOrgErr) {
        return new Response(JSON.stringify({ error: delOrgErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Unlink this login from any staff row (e.g. invited stylist at another salon)
    await adminClient.from("staff").update({ user_id: null }).eq("user_id", user_id);

    await adminClient.from("google_calendar_tokens").delete().eq("user_id", user_id);
    await adminClient.from("user_roles").delete().eq("user_id", user_id);
    await adminClient.from("profiles").delete().eq("id", user_id);
    await adminClient.from("app_users").delete().eq("id", user_id);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
