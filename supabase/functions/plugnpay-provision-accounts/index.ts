import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "npm:resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

function randomPassword(length = 18): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

function normalizeEmail(raw: unknown): string {
  if (raw == null || typeof raw !== "string") return "";
  return raw.trim().toLowerCase();
}

type BillingContact = Record<string, unknown>;

function contactFromOrder(order: { billing?: { contact?: BillingContact } }): BillingContact | null {
  const c = order?.billing?.contact;
  return c && typeof c === "object" ? c : null;
}

function contactEmail(c: BillingContact): string {
  return normalizeEmail(c.email ?? (c as { email_address?: string }).email_address);
}

function contactFullName(c: BillingContact): string {
  const fn = String(c.first_name ?? (c as { firstname?: string }).firstname ?? "").trim();
  const ln = String(c.last_name ?? (c as { lastname?: string }).lastname ?? "").trim();
  const combined = `${fn} ${ln}`.trim();
  if (combined) return combined;
  return String(c.name ?? "").trim();
}

const DEFAULT_LOGIN_URL = "https://booking.salonora.eu/";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

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

    const { data: isSuper } = await admin.rpc("has_role", { _user_id: caller.sub, _role: "super_admin" });
    if (!isSuper) {
      return new Response(JSON.stringify({ error: "Forbidden: super_admin role required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const plugKey = Deno.env.get("PLUGNPAY_API_KEY");
    if (!plugKey) {
      return new Response(JSON.stringify({ error: "PLUGNPAY_API_KEY is not configured for this project" }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const loginUrl = (Deno.env.get("SALONORA_LOGIN_URL") || Deno.env.get("APP_URL") || DEFAULT_LOGIN_URL).replace(
      /\/?$/,
      "/"
    );

    let page = 1;
    const allOrders: { billing?: { contact?: BillingContact } }[] = [];
    let lastPage = 1;

    do {
      const url = new URL("https://api.plugandpay.com/v2/orders");
      url.searchParams.set("limit", "25");
      url.searchParams.set("page", String(page));
      url.searchParams.set("include", "items,payment,products,subscriptions,billing,shipping,taxes,discounts,utm");

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${plugKey}`, Accept: "application/json" },
      });
      if (!res.ok) {
        const text = await res.text();
        return new Response(JSON.stringify({ error: `Plug&Pay API error ${res.status}`, detail: text.slice(0, 500) }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const result = await res.json();
      const batch = result.data ?? [];
      allOrders.push(...batch);
      lastPage = result.meta?.last_page ?? page;
      page += 1;
    } while (page <= lastPage);

    const emailToContact = new Map<string, BillingContact>();
    for (const order of allOrders) {
      const c = contactFromOrder(order);
      if (!c) continue;
      const em = contactEmail(c);
      if (!em) continue;
      if (!emailToContact.has(em)) emailToContact.set(em, c);
    }

    const resendKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") || "noreply@booking.salonora.eu";
    const fromName = Deno.env.get("RESEND_FROM_NAME") || "Salonora";

    const created: { email: string; user_id: string }[] = [];
    const skippedExisting: string[] = [];
    const errors: string[] = [];

    for (const [emailNorm, contact] of emailToContact) {
      const { data: existing } = await admin.from("app_users").select("id").eq("email", emailNorm).maybeSingle();
      if (existing) {
        skippedExisting.push(emailNorm);
        continue;
      }

      const plainPassword = randomPassword(18);
      const fullName = contactFullName(contact) || null;
      let userId: string;

      try {
        const passwordHash = await hashPassword(plainPassword);
        const { data: newUser, error: insertErr } = await admin
          .from("app_users")
          .insert({
            email: emailNorm,
            password_hash: passwordHash,
            full_name: fullName,
            approval_status: "approved",
            must_change_password: true,
          })
          .select("id")
          .single();
        if (insertErr) throw insertErr;
        userId = newUser.id;

        await admin.from("profiles").insert({ id: userId, email: emailNorm, full_name: fullName });
        await admin.from("user_roles").insert({ user_id: userId, role: "salon_owner" });
      } catch (e) {
        errors.push(`${emailNorm}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }

      created.push({ email: emailNorm, user_id: userId });

      if (resendKey) {
        try {
          const resend = new Resend(resendKey);
          const displayName = fullName || "there";
          const html = `
            <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px;">
              <h1 style="color: #3990f0;">Welcome to Salonora</h1>
              <p>Hi ${displayName},</p>
              <p>Thank you for your purchase. Your Salonora booking panel account is ready.</p>
              <p><strong>Sign in here:</strong><br />
              <a href="${loginUrl}" style="color: #3990f0;">${loginUrl}</a></p>
              <p><strong>Your email:</strong> ${emailNorm}</p>
              <p><strong>Your temporary password:</strong><br />
              <code style="background:#f3f4f6;padding:8px 12px;display:inline-block;border-radius:6px;font-size:15px;">${plainPassword}</code></p>
              <p>For security, please sign in and go to <strong>Settings</strong> to choose a new password right away.</p>
              <p style="color: #6b7280; font-size: 14px;">If you did not make this purchase, contact support.</p>
            </div>
          `;
          const { error: sendErr } = await resend.emails.send({
            from: `${fromName} <${fromEmail}>`,
            to: [emailNorm],
            subject: "Your Salonora account — thank you for your purchase",
            html,
          });
          if (sendErr) {
            errors.push(`${emailNorm} (email): ${JSON.stringify(sendErr)}`);
          }
        } catch (e) {
          errors.push(`${emailNorm} (email): ${e instanceof Error ? e.message : String(e)}`);
        }
      } else {
        errors.push(`${emailNorm}: RESEND_API_KEY not set — account created but no email sent`);
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        orders_scanned: allOrders.length,
        billing_emails_unique: emailToContact.size,
        created,
        skipped_existing_count: skippedExisting.length,
        errors,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
