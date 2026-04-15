import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const parts = stored.split(":");
  if (parts[0] !== "pbkdf2") return false;
  const iterations = parseInt(parts[1], 10);
  const salt = Uint8Array.from(atob(parts[2]), (c) => c.charCodeAt(0));
  const expectedHash = parts[3];
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key,
    256,
  );
  const hashB64 = btoa(String.fromCharCode(...new Uint8Array(derived)));
  return hashB64 === expectedHash;
}

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
      ["verify"],
    );
    const data = encoder.encode(`${parts[0]}.${parts[1]}`);
    const sig = Uint8Array.from(atob(parts[2].replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    const valid = await crypto.subtle.verify("HMAC", key, sig, data);
    if (!valid) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    if (!payload.sub || !payload.email) return null;
    return { sub: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}

async function deleteOrgScopedRows(admin: ReturnType<typeof createClient>, organizationId: string) {
  await admin.from("organizations").update({ owner_default_staff_id: null }).eq("id", organizationId);

  await admin.from("bookings").delete().eq("organization_id", organizationId);
  await admin.from("pending_booking_confirmations").delete().eq("organization_id", organizationId);
  await admin.from("confirmed_booking_customers").delete().eq("organization_id", organizationId);
  await admin.from("customer_reminder_preferences").delete().eq("organization_id", organizationId);
  await admin.from("organization_break_slots").delete().eq("organization_id", organizationId);
  await admin.from("location_closure_slots").delete().eq("organization_id", organizationId);
  await admin.from("organization_off_days").delete().eq("organization_id", organizationId);
  await admin.from("organization_holiday_overrides").delete().eq("organization_id", organizationId);

  const { data: staffIds } = await admin.from("staff").select("id").eq("organization_id", organizationId);
  const ids = (staffIds ?? []).map((r) => r.id as string);
  if (ids.length > 0) {
    await admin.from("availability").delete().in("staff_id", ids);
    await admin.from("staff_locations").delete().in("staff_id", ids);
  }
  await admin.from("staff_invitations").delete().eq("organization_id", organizationId);
  await admin.from("staff").delete().eq("organization_id", organizationId);
  await admin.from("services").delete().eq("organization_id", organizationId);
  await admin.from("locations").delete().eq("organization_id", organizationId);
  await admin.from("vat_rates").delete().eq("organization_id", organizationId);
}

function randomSlug(): string {
  const u = crypto.randomUUID().replace(/-/g, "");
  return `salon-${u.slice(0, 12)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const jwt = authHeader.replace("Bearer ", "");
    const caller = await verifyCustomJWT(jwt);
    if (!caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const action = body?.action as string;
    const password = body?.password as string;
    const confirmText = String(body?.confirm_text ?? "").trim();
    const organizationId = body?.organization_id as string | undefined;

    if (confirmText !== "CONFIRM") {
      return new Response(JSON.stringify({ error: 'Type CONFIRM exactly to proceed.' }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!password || typeof password !== "string") {
      return new Response(JSON.stringify({ error: "Password required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: isSuper } = await admin.rpc("has_role", { _user_id: caller.sub, _role: "super_admin" });
    if (isSuper) {
      return new Response(JSON.stringify({ error: "Super admin accounts cannot use this action here." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: userRow, error: userErr } = await admin
      .from("app_users")
      .select("id, password_hash, email")
      .eq("id", caller.sub)
      .maybeSingle();
    if (userErr || !userRow?.password_hash) {
      return new Response(JSON.stringify({ error: "Account not found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const ok = await verifyPassword(password, userRow.password_hash as string);
    if (!ok) {
      return new Response(JSON.stringify({ error: "Incorrect password" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "reset_salon_data") {
      if (!organizationId || typeof organizationId !== "string") {
        return new Response(JSON.stringify({ error: "organization_id required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: org, error: orgErr } = await admin
        .from("organizations")
        .select("id, name, owner_id")
        .eq("id", organizationId)
        .single();
      if (orgErr || !org || String(org.owner_id) !== caller.sub) {
        return new Response(JSON.stringify({ error: "Organization not found or access denied" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await deleteOrgScopedRows(admin, organizationId);

      const newSlug = randomSlug();
      const displayName = "My salon";
      const { error: upOrgErr } = await admin
        .from("organizations")
        .update({
          name: displayName,
          slug: newSlug,
          owner_default_staff_id: null,
          logo_url: null,
          stripe_account_id: null,
          embed_theme: null,
          holiday_region: "NL",
          timezone: "Europe/Amsterdam",
          gcal_use_staff_secondary_calendars: false,
          reminder_email_day_before: true,
          reminder_email_hour_before: true,
        })
        .eq("id", organizationId);
      if (upOrgErr) throw upOrgErr;

      const { data: phStaff, error: phErr } = await admin
        .from("staff")
        .insert({
          organization_id: organizationId,
          name: `${displayName} (bookings)`,
          user_id: caller.sub,
          is_owner_placeholder: true,
          is_active: true,
        })
        .select("id")
        .single();
      if (phErr || !phStaff?.id) throw phErr ?? new Error("placeholder staff");

      const { error: odErr } = await admin
        .from("organizations")
        .update({ owner_default_staff_id: phStaff.id as string })
        .eq("id", organizationId);
      if (odErr) throw odErr;

      const { data: loc, error: locErr } = await admin
        .from("locations")
        .insert({
          organization_id: organizationId,
          name: "Main",
          is_active: true,
        })
        .select("id")
        .single();
      if (locErr || !loc?.id) throw locErr ?? new Error("location");

      await admin.from("staff_locations").insert({ staff_id: phStaff.id as string, location_id: loc.id as string });

      const { error: rpcErr } = await admin.rpc("insert_default_vat_rates_for_org", { _org_id: organizationId });
      if (rpcErr) console.error("insert_default_vat_rates_for_org", rpcErr);

      return new Response(JSON.stringify({ success: true, slug: newSlug }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "delete_my_account") {
      const { data: owned } = await admin.from("organizations").select("id").eq("owner_id", caller.sub);
      for (const row of owned ?? []) {
        await deleteOrgScopedRows(admin, row.id as string);
        const { error: delO } = await admin.from("organizations").delete().eq("id", row.id as string);
        if (delO) throw delO;
      }

      await admin.from("google_calendar_tokens").delete().eq("user_id", caller.sub);
      await admin.from("user_roles").delete().eq("user_id", caller.sub);
      const { error: profDel } = await admin.from("profiles").delete().eq("id", caller.sub);
      if (profDel) console.warn("profiles delete (optional):", profDel);
      const { error: delUser } = await admin.from("app_users").delete().eq("id", caller.sub);
      if (delUser) throw delUser;

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
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
