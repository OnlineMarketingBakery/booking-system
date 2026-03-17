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
    const { email, reset_token } = await req.json();
    if (!email || !reset_token) throw new Error("email and reset_token are required");

    const appUrl = (Deno.env.get("APP_URL") || "").replace(/\/$/, "");
    const resetUrl = appUrl ? `${appUrl}/reset-password?token=${encodeURIComponent(reset_token)}` : "";

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px;">
        <h1 style="color: #3990f0;">Stel je wachtwoord opnieuw in</h1>
        <p>We hebben een verzoek ontvangen om het wachtwoord van je Salonora-account opnieuw in te stellen.</p>
        <p>Klik op de onderstaande link om een nieuw wachtwoord in te stellen. Deze link verloopt over 1 uur.</p>
        ${resetUrl ? `<p><a href="${resetUrl}" style="display: inline-block; background: #3990f0; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">Nieuw wachtwoord instellen</a></p>` : ""}
        <p style="color: #6b7280; font-size: 14px;">Als je dit niet hebt aangevraagd, kun je deze e-mail gerust negeren.</p>
      </div>
    `;

    const { data, error } = await resend.emails.send({
      from: `${fromName} <${fromEmail}>`,
      to: [email],
      subject: "Stel je Salonora-wachtwoord opnieuw in",
      html,
    });

    if (error) {
      const msg = typeof error === "object" && error !== null && "message" in error
        ? String((error as { message?: string }).message)
        : String(error);
      console.error("[send-forgot-password-email] Resend error:", error);
      return new Response(JSON.stringify({ error: msg }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    return new Response(JSON.stringify({ success: true, id: data?.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[send-forgot-password-email]", msg);
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
