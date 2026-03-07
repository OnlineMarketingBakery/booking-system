import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Simple HMAC-SHA256 JWT signing (no external deps)
async function createJWT(userId: string, email: string): Promise<string> {
  const secret = Deno.env.get("JWT_SECRET")!;
  const encoder = new TextEncoder();

  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const now = Math.floor(Date.now() / 1000);
  const payload = btoa(JSON.stringify({
    sub: userId,
    email,
    role: "authenticated",
    iss: "custom-auth",
    iat: now,
    exp: now + 86400, // 24h
  })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(`${header}.${payload}`));
  const signature = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  return `${header}.${payload}.${signature}`;
}

// Simple bcrypt-compatible password hashing using PBKDF2
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

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const parts = stored.split(":");
  if (parts[0] !== "pbkdf2") return false;
  const iterations = parseInt(parts[1]);
  const salt = Uint8Array.from(atob(parts[2]), c => c.charCodeAt(0));
  const expectedHash = parts[3];
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, 256
  );
  const hashB64 = btoa(String.fromCharCode(...new Uint8Array(derived)));
  return hashB64 === expectedHash;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const action = body.action;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    if (action === "signup") {
      const { email, password, fullName } = body;
      if (!email || !password) {
        return new Response(JSON.stringify({ error: "Email and password required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (password.length < 6) {
        return new Response(JSON.stringify({ error: "Password must be at least 6 characters" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: existing } = await admin
        .from("app_users")
        .select("id")
        .eq("email", email.toLowerCase().trim())
        .maybeSingle();

      if (existing) {
        return new Response(JSON.stringify({ error: "An account with this email already exists" }), {
          status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const passwordHash = await hashPassword(password);
      const { data: newUser, error: insertErr } = await admin
        .from("app_users")
        .insert({ email: email.toLowerCase().trim(), password_hash: passwordHash, full_name: fullName || null })
        .select("id, email, full_name")
        .single();

      if (insertErr) throw insertErr;

      // Create profile and assign role
      await admin.from("profiles").insert({ id: newUser.id, email: newUser.email, full_name: newUser.full_name });
      // First user ever becomes super_admin; everyone else gets salon_owner
      const { count } = await admin.from("user_roles").select("id", { count: "exact", head: true });
      const role = count === 0 ? "super_admin" : "salon_owner";
      await admin.from("user_roles").insert({ user_id: newUser.id, role });

      const token = await createJWT(newUser.id, newUser.email);

      return new Response(
        JSON.stringify({ token, user: { id: newUser.id, email: newUser.email, full_name: newUser.full_name } }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "signin") {
      const { email, password } = body;
      if (!email || !password) {
        return new Response(JSON.stringify({ error: "Email and password required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: user, error: findErr } = await admin
        .from("app_users")
        .select("id, email, full_name, password_hash")
        .eq("email", email.toLowerCase().trim())
        .maybeSingle();

      if (findErr || !user) {
        return new Response(JSON.stringify({ error: "Invalid email or password" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const valid = await verifyPassword(password, user.password_hash);
      if (!valid) {
        return new Response(JSON.stringify({ error: "Invalid email or password" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const token = await createJWT(user.id, user.email);

      return new Response(
        JSON.stringify({ token, user: { id: user.id, email: user.email, full_name: user.full_name } }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "reset-password") {
      const { email, newPassword } = body;
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!newPassword || newPassword.length < 6) {
        return new Response(JSON.stringify({ error: "Password must be at least 6 characters" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const passwordHash = await hashPassword(newPassword);
      const { error: updateErr } = await admin
        .from("app_users")
        .update({ password_hash: passwordHash })
        .eq("email", email.toLowerCase().trim());
      if (updateErr) throw updateErr;

      return new Response(
        JSON.stringify({ message: "Password updated successfully" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
