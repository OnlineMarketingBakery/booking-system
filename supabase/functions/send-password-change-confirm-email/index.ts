import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-runtime",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) throw new Error("RESEND_API_KEY is not set");

    const resend = new Resend(resendKey);
    const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") || "noreply@booking.salonora.eu";
    const fromName = Deno.env.get("RESEND_FROM_NAME") || "Salonora";
    const { email, full_name, confirm_token } = await req.json();
    if (!email || !confirm_token) throw new Error("email and confirm_token are required");

    const appUrl = (Deno.env.get("APP_URL") || "").replace(/\/$/, "");
    const confirmUrl = appUrl ? `${appUrl}/confirm-password-change?token=${encodeURIComponent(confirm_token)}` : "";
    const name = full_name || "there";

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px;">
        <h1 style="color: #3990f0;">Confirm your password change</h1>
        <p>Hi ${name},</p>
        <p>You requested a password change for your Salonora account. Click the link below to confirm and activate your new password.</p>
        ${confirmUrl ? `<p><a href="${confirmUrl}" style="display: inline-block; background: #3990f0; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">Confirm password change</a></p>` : ""}
        <p style="color: #6b7280; font-size: 14px;">If you didn't request this change, please contact support or reset your password again.</p>
      </div>
    `;

    await resend.emails.send({
      from: `${fromName} <${fromEmail}>`,
      to: [email],
      subject: "Confirm your password change - Salonora",
      html,
    });

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[send-password-change-confirm-email]", msg);
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
