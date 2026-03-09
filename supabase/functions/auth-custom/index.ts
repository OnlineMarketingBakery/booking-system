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
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!body || typeof body !== "object") {
      return new Response(
        JSON.stringify({ error: "Body must be a JSON object" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
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
      // First user ever is auto-approved and becomes super_admin; everyone else starts as pending
      const { count } = await admin.from("user_roles").select("id", { count: "exact", head: true });
      const isFirstUser = count === 0;
      const approvalStatus = isFirstUser ? "approved" : "pending";

      const { data: newUser, error: insertErr } = await admin
        .from("app_users")
        .insert({
          email: email.toLowerCase().trim(),
          password_hash: passwordHash,
          full_name: fullName || null,
          approval_status: approvalStatus,
        })
        .select("id, email, full_name")
        .single();

      if (insertErr) throw insertErr;

      // Create profile and assign role
      await admin.from("profiles").insert({ id: newUser.id, email: newUser.email, full_name: newUser.full_name });
      const role = isFirstUser ? "super_admin" : "salon_owner";
      await admin.from("user_roles").insert({ user_id: newUser.id, role });

      if (approvalStatus === "pending") {
        // Notify admin about new signup request (invoke send-signup-notification)
        const functionsUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;
        const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        try {
          const notifRes = await fetch(`${functionsUrl}/send-signup-notification`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${anonKey}`,
              "apikey": anonKey ?? "",
            },
            body: JSON.stringify({
              email: newUser.email,
              full_name: newUser.full_name,
              user_id: newUser.id,
            }),
          });
          if (!notifRes.ok) {
            const errText = await notifRes.text();
            console.error("[auth-custom] send-signup-notification failed:", notifRes.status, errText);
          }
        } catch (err) {
          console.error("[auth-custom] send-signup-notification error:", err);
        }

        return new Response(
          JSON.stringify({
            pending: true,
            message: "Your account has been created and is pending approval. You will receive an email when an admin approves your request.",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

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
        .select("id, email, full_name, password_hash, approval_status")
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

      if ((user as { approval_status?: string }).approval_status !== "approved") {
        return new Response(
          JSON.stringify({
            error: "Your account is pending approval. You will receive an email when an admin approves your request.",
          }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
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

    // --- Forgot password flow (no auth required) ---
    if (action === "request-password-reset") {
      const { email } = body;
      if (!email || typeof email !== "string") {
        return new Response(JSON.stringify({ error: "Email is required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const emailNorm = email.toLowerCase().trim();
      const { data: appUser } = await admin
        .from("app_users")
        .select("id")
        .eq("email", emailNorm)
        .eq("approval_status", "approved")
        .maybeSingle();
      if (!appUser) {
        return new Response(JSON.stringify({ success: true, message: "If an account exists with this email, you will receive a reset link." }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const resetToken = crypto.randomUUID();
      await admin.from("password_reset_tokens").insert({
        user_id: appUser.id,
        token: resetToken,
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });
      const functionsUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      try {
        await fetch(`${functionsUrl}/send-forgot-password-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${anonKey}`, "apikey": anonKey ?? "" },
          body: JSON.stringify({ email: emailNorm, reset_token: resetToken }),
        });
      } catch (e) {
        console.error("[auth-custom] send-forgot-password-email error:", e);
      }
      return new Response(JSON.stringify({ success: true, message: "If an account exists with this email, you will receive a reset link." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "set-new-password") {
      const { reset_token, new_password } = body;
      if (!reset_token || !new_password || new_password.length < 6) {
        return new Response(JSON.stringify({ error: "Invalid request. Password must be at least 6 characters." }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: row } = await admin
        .from("password_reset_tokens")
        .select("user_id")
        .eq("token", reset_token)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
      if (!row) {
        return new Response(JSON.stringify({ error: "This reset link is invalid or has expired." }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const passwordHash = await hashPassword(new_password);
      const confirmToken = crypto.randomUUID();
      await admin.from("pending_password_confirms").insert({
        token: confirmToken,
        user_id: row.user_id,
        password_hash: passwordHash,
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });
      await admin.from("password_reset_tokens").delete().eq("token", reset_token);
      const { data: userRow } = await admin.from("app_users").select("email, full_name").eq("id", row.user_id).single();
      const functionsUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      try {
        await fetch(`${functionsUrl}/send-password-change-confirm-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${anonKey}`, "apikey": anonKey ?? "" },
          body: JSON.stringify({
            email: userRow?.email,
            full_name: userRow?.full_name,
            confirm_token: confirmToken,
          }),
        });
      } catch (e) {
        console.error("[auth-custom] send-password-change-confirm-email error:", e);
      }
      return new Response(JSON.stringify({ success: true, message: "Check your email and click the link to confirm your new password." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "confirm-password-change") {
      const { confirm_token } = body;
      if (!confirm_token) {
        return new Response(JSON.stringify({ error: "Invalid confirmation link." }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: pending } = await admin
        .from("pending_password_confirms")
        .select("user_id, password_hash")
        .eq("token", confirm_token)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
      if (!pending) {
        return new Response(JSON.stringify({ error: "This confirmation link is invalid or has expired." }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      await admin.from("app_users").update({ password_hash: pending.password_hash }).eq("id", pending.user_id);
      await admin.from("pending_password_confirms").delete().eq("token", confirm_token);
      return new Response(JSON.stringify({ success: true, message: "Your password has been changed. You can now sign in." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ error: "Invalid action", received: action ?? "(missing)" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
