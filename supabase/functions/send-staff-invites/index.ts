import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Authorization required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    let userId: string;
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      if (!payload.sub || (payload.exp && payload.exp * 1000 < Date.now())) {
        throw new Error("Invalid or expired token");
      }
      userId = payload.sub;
    } catch {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: org } = await adminClient
      .from("organizations")
      .select("id, name")
      .eq("owner_id", userId)
      .maybeSingle();

    if (!org) {
      return new Response(JSON.stringify({ error: "Organization not found" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const rawEmails = Array.isArray(body.emails) ? body.emails : [];
    const emails = [...new Set(rawEmails.map((e: string) => String(e).trim().toLowerCase()).filter(Boolean))];
    if (emails.length === 0) {
      return new Response(JSON.stringify({ error: "At least one email is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) throw new Error("RESEND_API_KEY is not set");
    const resend = new Resend(resendKey);
    const appUrl = (Deno.env.get("APP_URL") || "").replace(/\/$/, "");
    const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") || "noreply@boeking.salonora.eu";

    const invited: string[] = [];
    const errors: string[] = [];

    for (const email of emails) {
      const token = crypto.randomUUID();
      const { data: existing } = await adminClient
        .from("staff_invitations")
        .select("id, status")
        .eq("organization_id", org.id)
        .eq("email", email)
        .maybeSingle();

      if (existing && existing.status === "pending") {
        errors.push(`${email}: already invited`);
        continue;
      }
      if (existing && existing.status === "accepted") {
        errors.push(`${email}: already accepted (can be added as staff)`);
        continue;
      }
      if (existing && existing.status === "revoked") {
        errors.push(`${email}: was removed from staff and cannot be re-invited`);
        continue;
      }

      if (existing && existing.status === "expired") {
        await adminClient.from("staff_invitations").update({
          status: "pending",
          token,
          invited_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        }).eq("id", existing.id);
      } else if (!existing) {
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        const { error: insErr } = await adminClient.from("staff_invitations").insert({
          organization_id: org.id,
          email,
          status: "pending",
          token,
          expires_at: expiresAt,
        });
        if (insErr) {
          errors.push(`${email}: ${insErr.message}`);
          continue;
        }
      }

      const acceptUrl = appUrl ? `${appUrl}/accept-staff-invite?token=${encodeURIComponent(token)}` : `#`;
      const expiresAtStr = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px;">
          <h1 style="color: #7c3aed;">You're invited to join ${org.name}</h1>
          <p>You have been invited to join as staff. Use the link below to accept or reject the invitation.</p>
          <p style="color: #6b7280; font-size: 14px;"><strong>This invitation expires on ${expiresAtStr}.</strong></p>
          ${appUrl ? `<p><a href="${acceptUrl}" style="display: inline-block; background: #7c3aed; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px;">Open invitation (accept or reject)</a></p>` : ""}
          <p style="color: #6b7280; font-size: 14px;">If you didn't expect this, you can ignore this email.</p>
        </div>
      `;

      try {
        await resend.emails.send({
          from: `${org.name} <${fromEmail}>`,
          to: [email],
          subject: `Join ${org.name} as staff`,
          html,
        });
        invited.push(email);
      } catch (e) {
        errors.push(`${email}: failed to send`);
      }
    }

    return new Response(
      JSON.stringify({ success: true, invited, errors }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[send-staff-invites] ERROR:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
