import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

// PBKDF2 password hashing (matches auth-custom)
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, key, 256
  );
  const saltB64 = btoa(String.fromCharCode(...salt));
  const hashB64 = btoa(String.fromCharCode(...new Uint8Array(derived)));
  return `pbkdf2:100000:${saltB64}:${hashB64}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    // Verify caller via custom JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Unauthorized");
    
    const token = authHeader.replace("Bearer ", "");
    const caller = await verifyCustomJWT(token);
    if (!caller) throw new Error("Unauthorized");

    // Check super_admin role
    const { data: hasRole } = await admin.rpc("has_role", { _user_id: caller.sub, _role: "super_admin" });
    if (!hasRole) throw new Error("Forbidden: super_admin role required");

    const { name, email, password, orgName, tier } = await req.json();
    if (!name || !email || !password || !orgName) {
      throw new Error("Missing required fields");
    }

    // Check if user already exists
    const { data: existing } = await admin
      .from("app_users")
      .select("id")
      .eq("email", email.toLowerCase().trim())
      .maybeSingle();

    let userId: string;

    if (existing) {
      // User exists — check if they already have an org
      const { data: existingOrg } = await admin
        .from("organizations")
        .select("id")
        .eq("owner_id", existing.id)
        .maybeSingle();
      if (existingOrg) throw new Error("An account with this email already exists and has an organization");
      userId = existing.id;
      // Ensure profile exists
      await admin.from("profiles").upsert({ id: userId, email: email.toLowerCase().trim(), full_name: name }, { onConflict: "id" });
    } else {
      // Create new app_user
      const passwordHash = await hashPassword(password);
      const { data: newUser, error: userErr } = await admin
        .from("app_users")
        .insert({ email: email.toLowerCase().trim(), password_hash: passwordHash, full_name: name })
        .select("id")
        .single();
      if (userErr) throw userErr;
      userId = newUser.id;
      // Create profile
      await admin.from("profiles").insert({ id: userId, email: email.toLowerCase().trim(), full_name: name });
    }

    // Ensure salon_owner role
    await admin.from("user_roles").upsert({ user_id: userId, role: "salon_owner" }, { onConflict: "user_id,role" });

    let slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

    // Ensure slug is unique
    const { data: existingOrg } = await admin
      .from("organizations")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (existingOrg) {
      slug = `${slug}-${Date.now().toString(36)}`;
    }

    // Create organization with tier
    const { error: orgErr } = await admin
      .from("organizations")
      .insert({ name: orgName, slug, owner_id: userId, tier: tier || "tier_1" });
    if (orgErr) throw orgErr;

    return new Response(JSON.stringify({ user_id: userId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
