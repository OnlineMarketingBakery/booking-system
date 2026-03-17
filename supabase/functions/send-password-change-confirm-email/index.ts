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
    const name = full_name || "beste klant";

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px;">
        <h1 style="color: #3990f0;">Bevestig je wachtwoordwijziging</h1>
        <p>Hallo ${name},</p>
        <p>Je hebt een wachtwoordwijziging aangevraagd voor je Salonora-account. Klik op de onderstaande link om te bevestigen en je nieuwe wachtwoord te activeren.</p>
        ${confirmUrl ? `<p><a href="${confirmUrl}" style="display: inline-block; background: #3990f0; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">Wachtwoordwijziging bevestigen</a></p>` : ""}
        <p style="color: #6b7280; font-size: 14px;">Als je deze wijziging niet hebt aangevraagd, neem dan contact op met de klantenservice of stel je wachtwoord opnieuw in.</p>
      </div>
    `;

    await resend.emails.send({
      from: `${fromName} <${fromEmail}>`,
      to: [email],
      subject: "Bevestig je wachtwoordwijziging - Salonora",
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
