/**
 * Create Salonora salon_owner from Plug&Pay billing contact (welcome email + password setup link).
 * Used by plugnpay-provision-accounts (bulk) and plugnpay-order-webhook (single order).
 */
import { Resend } from "npm:resend@2.0.0";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type BillingContact = Record<string, unknown>;

const DEFAULT_LOGIN_URL = "https://booking.salonora.eu/";

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

function normalizeEmail(raw: unknown): string {
  if (raw == null || typeof raw !== "string") return "";
  return raw.trim().toLowerCase();
}

export function contactFromOrder(order: { billing?: { contact?: BillingContact } }): BillingContact | null {
  const c = order?.billing?.contact;
  return c && typeof c === "object" ? c : null;
}

export function contactEmail(c: BillingContact): string {
  return normalizeEmail(c.email ?? (c as { email_address?: string }).email_address);
}

export function contactFullName(c: BillingContact): string {
  const fn = String(c.first_name ?? (c as { firstname?: string }).firstname ?? "").trim();
  const ln = String(c.last_name ?? (c as { lastname?: string }).lastname ?? "").trim();
  const combined = `${fn} ${ln}`.trim();
  if (combined) return combined;
  return String(c.name ?? "").trim();
}

/** Webhook payloads often use billing_details instead of billing.contact */
export function contactFromBillingDetails(d: unknown): BillingContact | null {
  if (!d || typeof d !== "object") return null;
  const o = d as Record<string, unknown>;
  const email = normalizeEmail(o.email ?? o.Email);
  if (!email) return null;
  return {
    email,
    first_name: o.first_name ?? o.firstname ?? o.given_name,
    last_name: o.last_name ?? o.lastname ?? o.family_name,
    name: o.name ?? o.full_name,
  };
}

export type ProvisionBuyerResult =
  | { outcome: "skipped"; email: string }
  | { outcome: "created"; email: string; user_id: string }
  | { outcome: "created_no_email"; email: string; user_id: string; email_error: string }
  | { outcome: "failed"; email?: string; reason: string };

export async function provisionSalonOwnerFromPlugnpayContact(
  admin: SupabaseClient,
  contact: BillingContact
): Promise<ProvisionBuyerResult> {
  const emailNorm = contactEmail(contact);
  if (!emailNorm) {
    return { outcome: "failed", reason: "No email on billing contact" };
  }

  const { data: existing } = await admin.from("app_users").select("id").eq("email", emailNorm).maybeSingle();
  if (existing) {
    return { outcome: "skipped", email: emailNorm };
  }

  const fullName = contactFullName(contact) || null;
  const setupToken = crypto.randomUUID();
  const lockHash = await hashPassword(crypto.randomUUID() + crypto.randomUUID());

  let userId: string;
  try {
    const { data: newUser, error: insertErr } = await admin
      .from("app_users")
      .insert({
        email: emailNorm,
        password_hash: lockHash,
        full_name: fullName,
        approval_status: "approved",
        must_change_password: false,
      })
      .select("id")
      .single();
    if (insertErr) throw insertErr;
    userId = newUser.id;

    await admin.from("profiles").insert({ id: userId, email: emailNorm, full_name: fullName });
    await admin.from("user_roles").insert({ user_id: userId, role: "salon_owner" });

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { error: tokErr } = await admin.from("purchase_account_setup_tokens").insert({
      user_id: userId,
      token: setupToken,
      expires_at: expiresAt,
    });
    if (tokErr) throw tokErr;
  } catch (e) {
    return {
      outcome: "failed",
      email: emailNorm,
      reason: e instanceof Error ? e.message : String(e),
    };
  }

  const loginUrl = (Deno.env.get("SALONORA_LOGIN_URL") || Deno.env.get("APP_URL") || DEFAULT_LOGIN_URL).replace(
    /\/?$/,
    "/"
  );
  const appUrl = (Deno.env.get("APP_URL") || loginUrl.replace(/\/$/, "")).replace(/\/$/, "");
  const setupUrl = appUrl ? `${appUrl}/complete-purchase-signup?token=${encodeURIComponent(setupToken)}` : "";

  const resendKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") || "noreply@booking.salonora.eu";
  const fromName = Deno.env.get("RESEND_FROM_NAME") || "Salonora";

  if (!resendKey) {
    return {
      outcome: "created_no_email",
      email: emailNorm,
      user_id: userId,
      email_error: "RESEND_API_KEY not set",
    };
  }

  try {
    const resend = new Resend(resendKey);
    const displayName = fullName || "there";
    const html = `
            <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px;">
              <h1 style="color: #3990f0;">Welcome to Salonora</h1>
              <p>Hi ${displayName},</p>
              <p>Thank you for your purchase. Your Salonora booking panel account is ready.</p>
              ${setupUrl ? `<p><strong>Create your password</strong> to sign in (this link is valid for 7 days):</p>
              <p><a href="${setupUrl}" style="display: inline-block; background: #3990f0; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">Choose your password</a></p>
              <p style="color: #6b7280; font-size: 14px;">After that, you can log in at <a href="${loginUrl}">${loginUrl}</a> with your email and the password you chose.</p>` : `<p>Visit <a href="${loginUrl}">${loginUrl}</a> and use “Forgot password” with this email to set a password.</p>`}
              <p style="color: #6b7280; font-size: 14px;">If you did not make this purchase, contact support.</p>
            </div>
          `;
    const { error: sendErr } = await resend.emails.send({
      from: `${fromName} <${fromEmail}>`,
      to: [emailNorm],
      subject: "Welcome to Salonora — create your password",
      html,
    });
    if (sendErr) {
      return {
        outcome: "created_no_email",
        email: emailNorm,
        user_id: userId,
        email_error: JSON.stringify(sendErr),
      };
    }
  } catch (e) {
    return {
      outcome: "created_no_email",
      email: emailNorm,
      user_id: userId,
      email_error: e instanceof Error ? e.message : String(e),
    };
  }

  return { outcome: "created", email: emailNorm, user_id: userId };
}
